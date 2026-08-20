import type { AdReadOnlyAdapter, AdReadOnlyAdapterResult } from "../adapters/adReadOnlyAdapter";
import type { TypedIntentEnvelope } from "../inbound/typedIntent";
import type { IntentValidator } from "../inbound/intentValidator";
import type { Logger } from "../logging/logger";
import type { IdentityContext } from "../policy/identityResolver";
import type { HermesSessionStore } from "../state/hermesSessionStore";
import type { AuthContextService, SignedAuthContext } from "../security/authContext";
import type { HermesClient } from "./hermesClient";

export interface HelpdeskBrokerAskRequest {
  chatId: string;
  chatType: "private" | "group" | "unknown";
  senderId: string;
  senderDisplayName?: string;
  message: string;
  requestId: string;
  quotedMessageId?: string;
  quotedText?: string;
  quotedParticipantId?: string;
  identity: IdentityContext;
  resetSession?: boolean;
  dryRun?: boolean;
  onAcknowledgement?: (text: string) => Promise<void>;
}

export interface HelpdeskBrokerAskResult {
  reply: string;
  sessionKey: string;
  sessionId?: string;
  previousSessionId?: string;
  usedDryRun: boolean;
  orchestration:
    | "legacy_conversation"
    | "typed_intent_backend"
    | "typed_intent_fallback"
    | "typed_intent_denied";
}

interface HelpdeskPromptContext {
  freshReset: boolean;
}

interface ParsedTypedIntent {
  raw: string;
  parsed?: TypedIntentEnvelope;
}

const DEFAULT_ACKNOWLEDGEMENT = "Baik, permintaan sedang diproses.";
const INTENT_SESSION_SEGMENT = "intent";

export class HelpdeskBroker {
  constructor(
    private readonly hermesClient: HermesClient,
    private readonly sessionStore: HermesSessionStore,
    private readonly authContextService: AuthContextService,
    private readonly intentValidator: IntentValidator,
    private readonly adReadOnlyAdapter: AdReadOnlyAdapter,
    private readonly authContextPolicyVersion: string,
    private readonly logger: Logger,
  ) {}

  async ask(request: HelpdeskBrokerAskRequest): Promise<HelpdeskBrokerAskResult> {
    if (request.resetSession) {
      this.reset(request.chatId);
    }

    const existingState = this.sessionStore.get(request.chatId);
    const sessionKey = existingState?.sessionKey ?? this.buildSessionKey(request.chatId);
    const authContext = this.authContextService.create({
      chatId: request.chatId,
      chatType: request.chatType,
      senderId: request.senderId,
      senderPhone: request.identity.canonicalPhone,
      role: request.identity.role,
      isRegisteredUser: request.identity.isRegisteredUser,
      sessionKey,
      sessionId: existingState?.sessionId,
      policyVersion: this.authContextPolicyVersion,
      requestId: request.requestId,
    });

    this.logBoundary("request", {
      chatId: request.chatId,
      sessionKey,
      previousSessionId: existingState?.sessionId,
      role: request.identity.role,
      requestId: authContext.request_id,
      dryRun: request.dryRun ?? false,
    });

    let acknowledgementSent = false;
    if (!request.dryRun && request.onAcknowledgement && this.shouldSendAcknowledgement(request.message)) {
      await request.onAcknowledgement(DEFAULT_ACKNOWLEDGEMENT);
      acknowledgementSent = true;
      this.logger.info("acknowledgement_sent", {
        chatId: request.chatId,
        requestId: authContext.request_id,
      });
    }

    const typedIntent = await this.generateTypedIntent(request, authContext, sessionKey);
    if (typedIntent.parsed) {
      const validation = this.intentValidator.validate({
        authContext,
        typedIntentCandidate: typedIntent.parsed,
      });

      if (validation.allowed && validation.validatedIntentName) {
        if (validation.validatedIntentName === "helpdesk.no_backend_action") {
          const fallback = await this.runLegacyConversation(request, existingState?.sessionId, sessionKey);
          return {
            ...fallback,
            orchestration: "typed_intent_fallback",
          };
        }

        const adapterResult = await this.dispatchTypedIntent(
          validation.validatedIntentName,
          validation.normalizedArguments ?? {},
          validation.validatedTargetRef?.value,
          request,
        );
        const summary = await this.summarizeAdapterResult(
          request,
          authContext,
          validation.validatedIntentName,
          adapterResult,
          existingState?.sessionId,
          sessionKey,
        );

        if (!request.dryRun) {
          this.sessionStore.set(request.chatId, {
            sessionKey,
            sessionId: summary.sessionId,
            updatedAt: new Date().toISOString(),
          });
        }

        return {
          reply: summary.reply,
          sessionKey,
          sessionId: summary.sessionId,
          previousSessionId: existingState?.sessionId,
          usedDryRun: request.dryRun ?? false,
          orchestration: "typed_intent_backend",
        };
      }

      this.logger.warn("typed_intent_denied", {
        chatId: request.chatId,
        requestId: authContext.request_id,
        denialCode: validation.denialCode,
        reason: validation.reason,
      });

      if (!acknowledgementSent && !request.dryRun && request.onAcknowledgement && this.shouldSendAcknowledgement(request.message)) {
        await request.onAcknowledgement(DEFAULT_ACKNOWLEDGEMENT);
      }

      const fallback = await this.runLegacyConversation(request, existingState?.sessionId, sessionKey);
      return {
        ...fallback,
        orchestration: "typed_intent_denied",
      };
    }

    const fallback = await this.runLegacyConversation(request, existingState?.sessionId, sessionKey);
    return {
      ...fallback,
      orchestration: "legacy_conversation",
    };
  }

  reset(chatId: string): boolean {
    const hadState = this.sessionStore.delete(chatId);
    this.sessionStore.bumpResetVersion(chatId);
    return Boolean(hadState);
  }

  private async generateTypedIntent(
    request: HelpdeskBrokerAskRequest,
    authContext: SignedAuthContext,
    sessionKey: string,
  ): Promise<ParsedTypedIntent> {
    const prompt = this.buildTypedIntentPrompt(request, authContext);
    const response = await this.hermesClient.chat({
      message: prompt,
      sessionKey: `${sessionKey}:${INTENT_SESSION_SEGMENT}:${authContext.request_id}`,
    });

    const parsed = this.tryParseTypedIntent(response.content);
    this.logger.info("typed_intent_generated", {
      chatId: request.chatId,
      requestId: authContext.request_id,
      parsed: Boolean(parsed),
      rawPreview: response.content.slice(0, 200),
      intentName: parsed?.intent_name,
    });

    return {
      raw: response.content,
      parsed,
    };
  }

  private async dispatchTypedIntent(
    intentName: TypedIntentEnvelope["intent_name"],
    normalizedArguments: Record<string, unknown>,
    targetRefValue: string | undefined,
    request: HelpdeskBrokerAskRequest,
  ): Promise<AdReadOnlyAdapterResult> {
    switch (intentName) {
      case "ad.get_self_profile":
        return this.adReadOnlyAdapter.getSelfProfile(
          request.identity,
          this.toStringArray(normalizedArguments.fields),
        );
      case "ad.get_self_status":
        return this.adReadOnlyAdapter.getSelfProfile(request.identity, ["displayName", "mail", "department", "title", "role"]);
      case "ad.lookup_user_profile": {
        const query = this.extractLookupQuery(targetRefValue, normalizedArguments, request.message);
        return this.adReadOnlyAdapter.lookupUserProfile(
          query,
          this.resolveLookupFields(this.toStringArray(normalizedArguments.fields), request.message),
        );
      }
      default:
        return this.adReadOnlyAdapter.unsupported(intentName);
    }
  }

  private async summarizeAdapterResult(
    request: HelpdeskBrokerAskRequest,
    authContext: SignedAuthContext,
    intentName: TypedIntentEnvelope["intent_name"],
    adapterResult: AdReadOnlyAdapterResult,
    sessionId: string | undefined,
    sessionKey: string,
  ): Promise<{ reply: string; sessionId?: string }> {
    if (intentName === "ad.lookup_user_profile") {
      return {
        reply: this.buildDeterministicFallbackReply(intentName, adapterResult),
        sessionId,
      };
    }

    const prompt = this.buildSummaryPrompt(request, authContext, intentName, adapterResult);
    try {
      const response = await this.hermesClient.chat({
        message: prompt,
        sessionKey,
        sessionId,
        metadata: {
          requestId: authContext.request_id,
          intentName,
          adapterResult,
        },
      });

      return {
        reply: response.content,
        sessionId: response.sessionId,
      };
    } catch (error: unknown) {
      this.logger.warn("typed_intent_summary_failed", {
        chatId: request.chatId,
        requestId: authContext.request_id,
        error,
      });
      return {
        reply: this.buildDeterministicFallbackReply(intentName, adapterResult),
        sessionId,
      };
    }
  }

  private async runLegacyConversation(
    request: HelpdeskBrokerAskRequest,
    sessionId: string | undefined,
    sessionKey: string,
  ): Promise<Omit<HelpdeskBrokerAskResult, "orchestration">> {
    const prompt = this.buildLegacyPrompt(request, {
      freshReset: !sessionId && this.sessionStore.getResetVersion(request.chatId) > 0,
    });
    const response = await this.hermesClient.chat({
      message: prompt,
      sessionKey,
      sessionId,
      metadata: {
        chatId: request.chatId,
        role: request.identity.role,
        senderPhone: request.identity.canonicalPhone,
      },
    });

    this.logBoundary("response", {
      chatId: request.chatId,
      sessionKey,
      sessionId: response.sessionId,
      replyPreview: response.content.slice(0, 120),
    });

    if (!request.dryRun) {
      this.sessionStore.set(request.chatId, {
        sessionKey,
        sessionId: response.sessionId,
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      reply: response.content,
      sessionKey,
      sessionId: response.sessionId,
      previousSessionId: sessionId,
      usedDryRun: request.dryRun ?? false,
    };
  }

  private buildSessionKey(chatId: string): string {
    const baseKey = chatId.endsWith("@c.us") ? `wa:private:${chatId}` : `wa:chat:${chatId}`;
    const resetVersion = this.sessionStore.getResetVersion(chatId);
    const resetSeed = this.sessionStore.getResetSeed(chatId);
    return resetVersion > 0 && resetSeed ? `wa:reset:${resetVersion}:${resetSeed}` : baseKey;
  }

  private buildLegacyPrompt(request: HelpdeskBrokerAskRequest, context: HelpdeskPromptContext): string {
    const senderLabel = request.senderDisplayName?.trim() || "Unknown sender";
    const profile = request.identity.adUser;

    return [
      "WhatsApp helpdesk context:",
      `- chat_id: ${request.chatId}`,
      `- channel: WhatsApp`,
      `- role: ${request.identity.role}`,
      `- sender_phone: ${request.identity.canonicalPhone ?? "unknown"}`,
      `- sender_display_name: ${senderLabel}`,
      "",
      "Reply context:",
      `- quoted_message_id: ${request.quotedMessageId ?? "none"}`,
      `- quoted_participant_id: ${request.quotedParticipantId ?? "none"}`,
      `- quoted_text: ${request.quotedText ?? "none"}`,
      "- If quoted_text is present, treat it as the parent message the user is referring to in this turn.",
      "",
      "Conversation scope rules:",
      `- Current conversation scope is limited to chat_id ${request.chatId}.`,
      "- Never use memory, facts, or transcript fragments from other chats, other phone numbers, other users, or other channels.",
      "",
      "Verified identity reference:",
      `- display_name: ${profile?.displayName ?? senderLabel}`,
      `- mail: ${profile?.mail ?? "unknown"}`,
      `- title: ${profile?.title ?? "unknown"}`,
      `- department: ${profile?.department ?? "unknown"}`,
      `- employee_id: ${profile?.employeeId ?? "unknown"}`,
      `- gender: ${profile?.gender ?? request.identity.technicianContact?.gender ?? "unknown"}`,
      "",
      "Operator rules:",
      "- You are MTI ICT Helpdesk operating through the dedicated marisa profile.",
      "- Reply in concise Indonesian suitable for WhatsApp.",
      "- If the sender asks for their own profile, answer using the verified identity reference above when available.",
      ...(context.freshReset
        ? [
            "- This chat was explicitly reset by the operator.",
            "- Ignore any memory from earlier conversations with this sender unless the user repeats it in the current message.",
          ]
        : []),
      "",
      "User message:",
      request.message.trim(),
    ].join("\n");
  }

  private buildTypedIntentPrompt(request: HelpdeskBrokerAskRequest, authContext: SignedAuthContext): string {
    return [
      "You are a strict typed intent generator for MTI ICT Helpdesk.",
      "Return JSON only. No markdown fences. No explanation.",
      "",
      "Allowed intents for current implementation:",
      '- "helpdesk.no_backend_action" for ordinary conversation or anything not clearly mapped to backend lookup',
      '- "ad.get_self_profile" when the sender asks who they are, asks for their own profile, or asks for their own office identity details',
      '- "ad.get_self_status" when the sender asks their own status in a lightweight way',
      '- "ad.lookup_user_profile" when a technician clearly asks to find or inspect another user profile, including safe troubleshooting fields such as passwordLastChanged',
      "",
      "Rules:",
      `- caller_role: ${authContext.role}`,
      `- caller_registered: ${authContext.is_registered_user ? "true" : "false"}`,
      "- Never invent caller identity, role, session, or auth fields.",
      "- Never emit LDAP filters or backend query syntax.",
      '- Use "target_scope":"self" with "target_ref":null for self intents.',
      '- Use "target_scope":"resolved_user" with a non-null target_ref for user lookup intents.',
      '- Use "target_scope":"no_target" with "target_ref":null for helpdesk.no_backend_action.',
      '- Put only safe backend arguments. For ad.lookup_user_profile you may include {"fields":[...]} and derive target_ref from the requested person.',
      '- Safe AD fields for ad.lookup_user_profile include: displayName, mail, title, department, employeeId, mobile, telephoneNumber, passwordLastChanged.',
      "",
      "JSON schema:",
      "{",
      '  "intent_version": "v1",',
      '  "intent_name": "helpdesk.no_backend_action | ad.get_self_profile | ad.get_self_status | ad.lookup_user_profile",',
      '  "confidence": 0.0,',
      '  "target_scope": "self | resolved_user | no_target",',
      '  "target_ref": null | {"type":"username|mail|employee_id|phone|directory_id","value":"..."},',
      '  "arguments": {},',
      `  "request_id": "${authContext.request_id}"`,
      "}",
      "",
      `chat_id: ${request.chatId}`,
      `sender_display_name: ${request.senderDisplayName ?? "unknown"}`,
      `sender_phone: ${request.identity.canonicalPhone ?? "unknown"}`,
      `quoted_text: ${request.quotedText ?? "none"}`,
      "user_message:",
      request.message.trim(),
    ].join("\n");
  }

  private buildSummaryPrompt(
    request: HelpdeskBrokerAskRequest,
    authContext: SignedAuthContext,
    intentName: TypedIntentEnvelope["intent_name"],
    adapterResult: AdReadOnlyAdapterResult,
  ): string {
    return [
      "You are MTI ICT Helpdesk summarizing a safe backend result for WhatsApp.",
      "Reply in concise Indonesian.",
      "Use only the safe_result below. Do not invent hidden data.",
      "If success is false, explain it briefly and clearly.",
      "",
      `request_id: ${authContext.request_id}`,
      `chat_id: ${request.chatId}`,
      `intent_name: ${intentName}`,
      `caller_role: ${request.identity.role}`,
      "",
      "safe_result_json:",
      JSON.stringify(
        {
          success: adapterResult.success,
          code: adapterResult.code,
          safe_result: adapterResult.safeResult,
        },
        null,
        2,
      ),
    ].join("\n");
  }

  private buildDeterministicFallbackReply(
    intentName: TypedIntentEnvelope["intent_name"],
    adapterResult: AdReadOnlyAdapterResult,
  ): string {
    if (adapterResult.code === "not_found") {
      return "Data yang diminta tidak ditemukan.";
    }

    if (adapterResult.code === "unsupported") {
      return "Permintaan backend ini belum diaktifkan di channel WhatsApp.";
    }

    if (!adapterResult.success) {
      return "Permintaan belum bisa diselesaikan saat ini.";
    }

    if (intentName === "ad.get_self_profile" || intentName === "ad.get_self_status") {
      const pairs = Object.entries(adapterResult.safeResult)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(", ");
      return pairs ? `Profil Anda: ${pairs}.` : "Profil Anda berhasil ditemukan.";
    }

    if (intentName === "ad.lookup_user_profile") {
      const matches = Array.isArray(adapterResult.safeResult.matches)
        ? adapterResult.safeResult.matches as Array<Record<string, unknown>>
        : [];
      if (matches.length === 0) {
        return "User yang diminta tidak ditemukan.";
      }

      const first = matches[0];
      const lines = [
        typeof first.displayName === "string" && first.displayName ? `Nama: ${first.displayName}` : undefined,
        typeof first.mail === "string" && first.mail ? `Email: ${first.mail}` : undefined,
        typeof first.title === "string" && first.title ? `Jabatan: ${first.title}` : undefined,
        typeof first.department === "string" && first.department ? `Departemen: ${first.department}` : undefined,
        typeof first.employeeId === "string" && first.employeeId ? `ID Karyawan: ${first.employeeId}` : undefined,
        typeof first.mobile === "string" && first.mobile ? `Mobile: ${first.mobile}` : undefined,
        typeof first.telephoneNumber === "string" && first.telephoneNumber ? `Telephone: ${first.telephoneNumber}` : undefined,
        typeof first.passwordLastChanged === "string" && first.passwordLastChanged
          ? `Password terakhir diganti: ${this.formatDateTime(first.passwordLastChanged)}`
          : undefined,
      ].filter((value): value is string => Boolean(value));

      return lines.length > 0
        ? `Ditemukan 1 user:\n${lines.join("\n")}`
        : "User ditemukan, tetapi field aman yang diminta tidak tersedia.";
    }

    return "Permintaan berhasil diproses.";
  }

  private shouldSendAcknowledgement(message: string): boolean {
    return /(cari|lookup|status|backup|veeam|restore|profile|profil|siapa saya|siapa aku|employee|departemen|email)/i.test(
      message,
    );
  }

  private extractLookupQuery(
    targetRefValue: string | undefined,
    normalizedArguments: Record<string, unknown>,
    fallbackMessage: string,
  ): string {
    if (targetRefValue?.trim()) {
      return targetRefValue.trim();
    }

    const fieldsToCheck = [
      normalizedArguments.query,
      normalizedArguments.user,
      normalizedArguments.name,
      normalizedArguments.target,
    ];

    for (const value of fieldsToCheck) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }

    return fallbackMessage.trim();
  }

  private toStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const list = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    return list.length > 0 ? list : undefined;
  }

  private resolveLookupFields(requestedFields: string[] | undefined, message: string): string[] | undefined {
    const fields = new Set(
      ["displayName", "mail", "title", "department", "employeeId", "mobile", "telephoneNumber", ...(requestedFields ?? [])]
        .map((field) => field.trim())
        .filter((field) => field.length > 0),
    );

    if (
      /(password terakhir diganti|kapan password|last password change|password last changed|pwdlastset|pwd last set)/i.test(
        message,
      )
    ) {
      fields.add("passwordLastChanged");
      fields.add("displayName");
      fields.add("mail");
    }

    return fields.size > 0 ? [...fields] : undefined;
  }

  private formatDateTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
      timeZone: "Asia/Jakarta",
    }).format(parsed);
  }

  private tryParseTypedIntent(raw: string): TypedIntentEnvelope | undefined {
    const candidates = [raw.trim()];
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      candidates.push(fencedMatch[1].trim());
    }

    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      candidates.push(objectMatch[0].trim());
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as TypedIntentEnvelope;
      } catch {
        // Try the next candidate.
      }
    }

    return undefined;
  }

  private logBoundary(stage: "request" | "response", payload: Record<string, unknown>): void {
    this.logger.info(`broker_${stage}`, payload);
  }
}
