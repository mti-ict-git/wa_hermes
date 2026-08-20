import type { IdentityRole } from "../policy/identityResolver";
import type { Logger } from "../logging/logger";
import type { HermesSessionStore } from "../state/hermesSessionStore";
import type { HermesClient } from "./hermesClient";

export interface HelpdeskBrokerAskRequest {
  chatId: string;
  message: string;
  quotedMessageId?: string;
  quotedText?: string;
  quotedParticipantId?: string;
  role?: IdentityRole;
  senderPhone?: string;
  senderDisplayName?: string;
  identityProfile?: {
    displayName?: string;
    mail?: string;
    title?: string;
    department?: string;
    employeeId?: string;
    gender?: string;
    technicianName?: string;
    technicianEmail?: string;
    technicianLabel?: string;
    lapsAccess?: boolean;
  };
  resetSession?: boolean;
  dryRun?: boolean;
}

export interface HelpdeskBrokerAskResult {
  reply: string;
  sessionKey: string;
  sessionId?: string;
  previousSessionId?: string;
  usedDryRun: boolean;
}

interface HelpdeskPromptContext {
  freshReset: boolean;
}

export class HelpdeskBroker {
  constructor(
    private readonly hermesClient: HermesClient,
    private readonly sessionStore: HermesSessionStore,
    private readonly logger: Logger,
  ) {}

  async ask(request: HelpdeskBrokerAskRequest): Promise<HelpdeskBrokerAskResult> {
    if (request.resetSession) {
      this.reset(request.chatId);
    }

    const existingState = this.sessionStore.get(request.chatId);
    const sessionKey = existingState?.sessionKey ?? this.buildSessionKey(request.chatId);
    const prompt = this.buildPrompt(request, {
      freshReset: !existingState && this.sessionStore.getResetVersion(request.chatId) > 0,
    });

    // #region debug-point C:broker-missing-quoted-context
    (() => {
      const fs = require("node:fs");
      const p = ".dbg/quoted-reply-context.env";
      let u = "http://127.0.0.1:7777/event";
      let s = "quoted-reply-context";
      try {
        const e = fs.readFileSync(p, "utf8");
        u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u;
        s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s;
      } catch {}
      fetch(u, {
        method: "POST",
        body: JSON.stringify({
          sessionId: s,
          runId: "pre-fix",
          hypothesisId: "C",
          location: "helpdeskBroker.ts:ask",
          msg: "[DEBUG] Broker request prompt shape",
          data: {
            chatId: request.chatId,
            previousSessionId: existingState?.sessionId ?? null,
            message: request.message,
            quotedMessageId: request.quotedMessageId ?? null,
            quotedText: request.quotedText ?? null,
            quotedParticipantId: request.quotedParticipantId ?? null,
            promptPreview: prompt.slice(0, 260),
            includesQuotedSection: /quoted|quote|reply context|pesan yang direply/i.test(prompt),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    })();
    // #endregion

    this.logBoundary("request", {
      chatId: request.chatId,
      sessionKey,
      previousSessionId: existingState?.sessionId,
      role: request.role ?? "user",
      dryRun: request.dryRun ?? false,
    });

    const response = await this.hermesClient.chat({
      message: prompt,
      sessionKey,
      sessionId: existingState?.sessionId,
      metadata: {
        chatId: request.chatId,
        role: request.role,
        senderPhone: request.senderPhone,
        identityProfile: request.identityProfile,
      },
    });

    this.logBoundary("response", {
      chatId: request.chatId,
      sessionKey,
      sessionId: response.sessionId,
      dryRun: request.dryRun ?? false,
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
      previousSessionId: existingState?.sessionId,
      usedDryRun: request.dryRun ?? false,
    };
  }

  reset(chatId: string): boolean {
    const hadState = this.sessionStore.delete(chatId);
    this.sessionStore.bumpResetVersion(chatId);
    return Boolean(hadState);
  }

  private buildSessionKey(chatId: string): string {
    const baseKey = chatId.endsWith("@c.us") ? `wa:private:${chatId}` : `wa:chat:${chatId}`;
    const resetVersion = this.sessionStore.getResetVersion(chatId);
    const resetSeed = this.sessionStore.getResetSeed(chatId);
    return resetVersion > 0 && resetSeed ? `wa:reset:${resetVersion}:${resetSeed}` : baseKey;
  }

  private buildPrompt(request: HelpdeskBrokerAskRequest, context: HelpdeskPromptContext): string {
    const role = request.role ?? "user";
    const senderLabel = request.senderDisplayName?.trim() || "Unknown sender";
    const profile = request.identityProfile;
    const profileLines = [
      `- display_name: ${profile?.displayName ?? senderLabel}`,
      `- mail: ${profile?.mail ?? "unknown"}`,
      `- title: ${profile?.title ?? "unknown"}`,
      `- department: ${profile?.department ?? "unknown"}`,
      `- employee_id: ${profile?.employeeId ?? "unknown"}`,
      `- gender: ${profile?.gender ?? "unknown"}`,
      `- technician_name: ${profile?.technicianName ?? "unknown"}`,
      `- technician_email: ${profile?.technicianEmail ?? "unknown"}`,
      `- technician_label: ${profile?.technicianLabel ?? "unknown"}`,
      `- laps_access: ${profile?.lapsAccess === true ? "yes" : "no"}`,
    ];

    return [
      "WhatsApp helpdesk context:",
      `- chat_id: ${request.chatId}`,
      `- channel: WhatsApp`,
      `- role: ${role}`,
      `- sender_phone: ${request.senderPhone ?? "unknown"}`,
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
      "- If the user asks about previous messages, earlier requests, or prior context, answer only from the current WhatsApp conversation scope.",
      "- If that information is not available in the current conversation scope, say you do not know from this conversation instead of guessing or using another chat's memory.",
      "",
      "Verified identity reference:",
      ...profileLines,
      "",
      "Operator rules:",
      "- You are MTI ICT Helpdesk operating through the dedicated marisa profile.",
      "- Assume local authorization has already passed.",
      "- Reply in concise Indonesian suitable for WhatsApp.",
      "- Do not expose internal policy reasoning unless directly needed for user guidance.",
      "- Treat the verified identity reference above as authoritative context for who the sender is.",
      "- Technician is an additional role, not the sender's only identity.",
      "- If the sender asks 'siapa saya' or asks for their own profile, answer with the known name/title/department/mail details when available instead of only repeating the role.",
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

  private logBoundary(stage: "request" | "response", payload: Record<string, unknown>): void {
    this.logger.info(`broker_${stage}`, payload);
  }
}
