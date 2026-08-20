export type ChatType = "private" | "group" | "unknown";
export type OpenWAMessageDirection = "incoming" | "outgoing";

export interface OpenWASessionSummary {
  id: string;
  name: string;
  status: string;
  phone?: string;
  pushName?: string;
  connectedAt?: string;
  lastActive?: string;
  createdAt?: string;
  updatedAt?: string;
  lastError?: string | null;
  autoRestartEnabled?: boolean;
  autoRestartPausedByUser?: boolean;
}

export interface OpenWAMessage {
  id: string;
  sessionId?: string;
  waMessageId?: string;
  chatId: string;
  chatName?: string | null;
  from: string;
  to: string;
  body: string;
  type: string;
  direction: OpenWAMessageDirection;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
  status?: string;
  createdAt?: string;
}

export interface OpenWARecentMessagesResponse {
  messages: OpenWAMessage[];
  total: number;
}

export interface OpenWASendTextRequest {
  chatId: string;
  text: string;
}

export interface OpenWAReplyRequest extends OpenWASendTextRequest {
  quotedMessageId: string;
}

export interface OpenWAMessageResponse {
  [key: string]: unknown;
}

export interface NormalizedChatIdentity {
  chatId: string;
  chatType: ChatType;
  sourceId?: string;
  canonicalPhone?: string;
}

export interface NormalizedInboundEvent {
  messageId: string;
  waMessageId?: string;
  sessionId?: string;
  chatId: string;
  chatName?: string | null;
  chatType: ChatType;
  direction: OpenWAMessageDirection;
  messageType: string;
  senderId: string;
  recipientId: string;
  senderPhone?: string;
  recipientPhone?: string;
  canonicalPhone?: string;
  mentionIds?: string[];
  addressedToBot: boolean;
  text: string;
  quotedMessageId?: string;
  quotedText?: string;
  quotedParticipantId?: string;
  timestamp: number;
  createdAt?: string;
  status?: string;
  raw: OpenWAMessage;
}
