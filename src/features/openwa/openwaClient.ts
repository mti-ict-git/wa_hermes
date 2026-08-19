import type { OpenWAConfig } from "../../config/types";
import { isPrivateChat } from "./eventNormalizer";
import type {
  OpenWAMessage,
  OpenWAMessageResponse,
  OpenWAReplyRequest,
  OpenWARecentMessagesResponse,
  OpenWASendTextRequest,
  OpenWASessionSummary,
} from "./types";

interface RequestOptions {
  method?: "GET" | "POST";
  payload?: unknown;
}

export class OpenWAClient {
  constructor(private readonly config: OpenWAConfig) {}

  async getSession(): Promise<OpenWASessionSummary> {
    return this.requestJson<OpenWASessionSummary>(`/api/sessions/${this.config.sessionId}`);
  }

  async getRecentMessages(limit = 10): Promise<OpenWARecentMessagesResponse> {
    const query = new URLSearchParams({ limit: String(limit) });
    return this.requestJson<OpenWARecentMessagesResponse>(
      `/api/sessions/${this.config.sessionId}/messages?${query.toString()}`,
    );
  }

  async sendText(chatId: string, text: string): Promise<OpenWAMessageResponse> {
    const payload: OpenWASendTextRequest = {
      chatId,
      text,
    };

    return this.requestJson<OpenWAMessageResponse>(
      `/api/sessions/${this.config.sessionId}/messages/send-text`,
      {
        method: "POST",
        payload,
      },
    );
  }

  async replyToMessage(
    chatId: string,
    quotedMessageId: string,
    text: string,
  ): Promise<OpenWAMessageResponse> {
    const payload: OpenWAReplyRequest = {
      chatId,
      quotedMessageId,
      text,
    };

    return this.requestJson<OpenWAMessageResponse>(`/api/sessions/${this.config.sessionId}/messages/reply`, {
      method: "POST",
      payload,
    });
  }

  private async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.apiKey,
      },
      body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenWA request failed (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }
}

export function getLatestIncomingPrivateMessage(messages: OpenWAMessage[]): OpenWAMessage | undefined {
  return messages.find((message) => message.direction === "incoming" && isPrivateChat(message.chatId));
}
