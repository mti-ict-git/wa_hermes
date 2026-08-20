import type { OpenWAClient } from "./openwaClient";
import type { Logger } from "../logging/logger";

export class MessagingService {
  constructor(
    private readonly openwaClient: OpenWAClient,
    private readonly logger: Logger,
  ) {}

  async sendText(chatId: string, text: string): Promise<void> {
    await this.openwaClient.sendText(chatId, text);
    this.logger.info("send_text_succeeded", {
      chatId,
      textPreview: text.slice(0, 120),
    });
  }

  async replyToMessage(chatId: string, quotedMessageId: string, text: string): Promise<void> {
    await this.openwaClient.replyToMessage(chatId, quotedMessageId, text);
    this.logger.info("reply_to_message_succeeded", {
      chatId,
      quotedMessageId,
      textPreview: text.slice(0, 120),
    });
  }

  async sendReplyOrText(chatId: string, quotedMessageId: string | undefined, text: string): Promise<"reply" | "send-text"> {
    if (quotedMessageId) {
      try {
        await this.replyToMessage(chatId, quotedMessageId, text);
        return "reply";
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn("reply_to_message_failed", {
          chatId,
          quotedMessageId,
          error,
        });
        if (!message.includes("404")) {
          throw error;
        }
      }
    }

    await this.sendText(chatId, text);
    return "send-text";
  }
}
