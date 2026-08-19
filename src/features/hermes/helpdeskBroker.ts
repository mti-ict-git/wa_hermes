import type { IdentityRole } from "../policy/identityResolver";
import type { HermesSessionStore } from "../state/hermesSessionStore";
import type { HermesClient } from "./hermesClient";

export interface HelpdeskBrokerAskRequest {
  chatId: string;
  message: string;
  role?: IdentityRole;
  senderPhone?: string;
  senderDisplayName?: string;
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

    return [
      "WhatsApp helpdesk context:",
      `- chat_id: ${request.chatId}`,
      `- channel: WhatsApp`,
      `- role: ${role}`,
      `- sender_phone: ${request.senderPhone ?? "unknown"}`,
      `- sender_display_name: ${senderLabel}`,
      "",
      "Operator rules:",
      "- You are MTI ICT Helpdesk operating through the dedicated marisa profile.",
      "- Assume local authorization has already passed.",
      "- Reply in concise Indonesian suitable for WhatsApp.",
      "- Do not expose internal policy reasoning unless directly needed for user guidance.",
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
    console.log(`[helpdesk-broker:${stage}] ${JSON.stringify(payload)}`);
  }
}
