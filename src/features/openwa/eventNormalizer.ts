import type { ChatType, NormalizedChatIdentity, NormalizedInboundEvent, OpenWAMessage } from "./types";

const PRIVATE_CHAT_SUFFIXES = ["@c.us", "@lid"];

export function normalizePhone(rawValue: string): string | undefined {
  const digits = rawValue.replace(/\D/g, "");
  return digits || undefined;
}

function isDirectPhoneAddress(rawValue: string): boolean {
  return rawValue.endsWith("@c.us") || /^\d{8,20}$/.test(rawValue);
}

function getCanonicalPhoneCandidate(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  if (!isDirectPhoneAddress(rawValue)) {
    return undefined;
  }

  const digits = normalizePhone(rawValue);
  return digits && digits.length >= 8 ? digits : undefined;
}

export function getChatType(chatId: string): ChatType {
  if (chatId.endsWith("@g.us")) {
    return "group";
  }

  if (PRIVATE_CHAT_SUFFIXES.some((suffix) => chatId.endsWith(suffix)) || /^\d{8,20}$/.test(chatId)) {
    return "private";
  }

  return "unknown";
}

export function isPrivateChat(chatId: string): boolean {
  return getChatType(chatId) === "private";
}

export function normalizeChatIdentity(chatId: string, sourceId?: string): NormalizedChatIdentity {
  return {
    chatId,
    chatType: getChatType(chatId),
    sourceId,
    canonicalPhone: getCanonicalPhoneCandidate(chatId) ?? getCanonicalPhoneCandidate(sourceId),
  };
}

function getSenderId(message: OpenWAMessage): string {
  return message.direction === "incoming" ? message.from : message.to;
}

function getRecipientId(message: OpenWAMessage): string {
  return message.direction === "incoming" ? message.to : message.from;
}

export function normalizeInboundMessage(message: OpenWAMessage): NormalizedInboundEvent {
  const senderId = getSenderId(message);
  const identity = normalizeChatIdentity(message.chatId, senderId);

  return {
    messageId: message.id,
    waMessageId: message.waMessageId,
    sessionId: message.sessionId,
    chatId: message.chatId,
    chatName: message.chatName,
    chatType: identity.chatType,
    direction: message.direction,
    messageType: message.type,
    senderId,
    recipientId: getRecipientId(message),
    senderPhone: getCanonicalPhoneCandidate(senderId),
    canonicalPhone: identity.canonicalPhone,
    text: message.body,
    timestamp: message.timestamp,
    createdAt: message.createdAt,
    status: message.status,
    raw: message,
  };
}

export function normalizeRecentMessages(messages: OpenWAMessage[]): NormalizedInboundEvent[] {
  return messages.map((message) => normalizeInboundMessage(message));
}
