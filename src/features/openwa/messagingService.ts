import type { OpenWAClient } from "./openwaClient";

export class MessagingService {
  constructor(private readonly openwaClient: OpenWAClient) {}

  async sendText(chatId: string, text: string): Promise<void> {
    await this.openwaClient.sendText(chatId, text);
  }

  async replyToMessage(chatId: string, quotedMessageId: string, text: string): Promise<void> {
    await this.openwaClient.replyToMessage(chatId, quotedMessageId, text);
  }
}
