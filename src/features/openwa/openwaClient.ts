import type { OpenWAConfig } from "../../config/types";
import type { Logger } from "../logging/logger";
import { withRetry } from "../runtime/retryPolicy";
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
  constructor(
    private readonly config: OpenWAConfig,
    private readonly logger: Logger,
  ) {}

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
    const target = `${this.config.baseUrl}${path}`;

    return withRetry(
      this.config.retryPolicy,
      this.logger,
      {
        operation: `openwa.${(options.method ?? "GET").toLowerCase()}`,
        target,
      },
      async (attempt, signal) => {
        this.logger.debug("request_started", {
          operation: "openwa.request",
          attempt,
          method: options.method ?? "GET",
          path,
        });

        const response = await fetch(target, {
          method: options.method ?? "GET",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.config.apiKey,
          },
          body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
          signal,
        });

        if (!response.ok) {
          const body = await response.text();
          const error = new Error(`OpenWA request failed (${response.status}): ${body}`);
          (error as Error & { status?: number }).status = response.status;
          throw error;
        }

        this.logger.info("request_succeeded", {
          operation: "openwa.request",
          attempt,
          method: options.method ?? "GET",
          path,
        });

        return (await response.json()) as T;
      },
      (error) => this.isRetryable(error),
    );
  }

  private isRetryable(error: unknown): boolean {
    const status =
      typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : undefined;

    if (status !== undefined) {
      return status >= 500 || status === 429;
    }

    if (error instanceof Error) {
      return error.name === "TimeoutError" || error.name === "AbortError" || /fetch failed/i.test(error.message);
    }

    return false;
  }
}

export function getLatestIncomingPrivateMessage(messages: OpenWAMessage[]): OpenWAMessage | undefined {
  return messages.find((message) => message.direction === "incoming" && isPrivateChat(message.chatId));
}
