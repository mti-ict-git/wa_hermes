import type { ChatType, NormalizedChatIdentity, NormalizedInboundEvent, OpenWAMessage } from "./types";

const PRIVATE_CHAT_SUFFIXES = ["@c.us", "@lid"];

type UnknownRecord = Record<string, unknown>;

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

function normalizeJidLike(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  if (rawValue.endsWith("@g.us") || rawValue.endsWith("@c.us") || rawValue.endsWith("@lid")) {
    return rawValue;
  }

  const digits = normalizePhone(rawValue);
  return digits && digits.length >= 8 ? `${digits}@c.us` : rawValue;
}

function readMentionIdsFromText(text: string): string[] {
  const matches = text.match(/@\d{8,20}/g) ?? [];
  return matches
    .map((match) => normalizeJidLike(match.slice(1)))
    .filter((value): value is string => Boolean(value));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function collectMentionIds(...values: unknown[]): string[] {
  const mentionIds = new Set<string>();

  for (const value of values) {
    for (const entry of asStringArray(value)) {
      const normalized = normalizeJidLike(entry);
      if (normalized) {
        mentionIds.add(normalized);
      }
    }
  }

  return [...mentionIds];
}

function isAddressedToBot(
  chatType: ChatType,
  recipientId: string | undefined,
  mentionIds: string[],
  text: string,
  botMentionAliases: string[] = [],
): boolean {
  if (chatType !== "group") {
    return true;
  }

  const normalizedRecipientId = normalizeJidLike(recipientId);
  const normalizedRecipientPhone = normalizedRecipientId ? normalizePhone(normalizedRecipientId) : undefined;
  const normalizedMentions = mentionIds.map((entry) => normalizeJidLike(entry)).filter((entry): entry is string => Boolean(entry));
  const textMentionPhones = readMentionIdsFromText(text).map((entry) => normalizePhone(entry)).filter((entry): entry is string => Boolean(entry));
  const normalizedAliases = botMentionAliases
    .map((entry) => normalizePhone(entry))
    .filter((entry): entry is string => Boolean(entry));

  if (normalizedRecipientId && normalizedMentions.includes(normalizedRecipientId)) {
    return true;
  }

  if (normalizedRecipientPhone && normalizedMentions.some((entry) => normalizePhone(entry) === normalizedRecipientPhone)) {
    return true;
  }

  if (normalizedRecipientPhone && textMentionPhones.includes(normalizedRecipientPhone)) {
    return true;
  }

  if (normalizedAliases.some((alias) => normalizedMentions.some((entry) => normalizePhone(entry) === alias))) {
    return true;
  }

  if (normalizedAliases.some((alias) => textMentionPhones.includes(alias))) {
    return true;
  }

  return false;
}

export function normalizeInboundMessage(message: OpenWAMessage, botMentionAliases: string[] = []): NormalizedInboundEvent {
  const senderId = getSenderId(message);
  const recipientId = getRecipientId(message);
  const identity = normalizeChatIdentity(message.chatId, senderId);
  const mentionIds = collectMentionIds(message.metadata?.mentionedJid, readMentionIdsFromContainer(message.metadata));
  const addressedToBot = isAddressedToBot(identity.chatType, recipientId, mentionIds, message.body, botMentionAliases);

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
    recipientId,
    senderPhone: getCanonicalPhoneCandidate(senderId),
    recipientPhone: getCanonicalPhoneCandidate(recipientId),
    canonicalPhone: identity.canonicalPhone,
    mentionIds,
    addressedToBot,
    text: message.body,
    timestamp: message.timestamp,
    createdAt: message.createdAt,
    status: message.status,
    raw: message,
  };
}

export function normalizeRecentMessages(messages: OpenWAMessage[], botMentionAliases: string[] = []): NormalizedInboundEvent[] {
  return messages.map((message) => normalizeInboundMessage(message, botMentionAliases));
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function normalizeSenderId(senderId: string): string {
  if (senderId.endsWith("@g.us") || senderId.endsWith("@lid")) {
    return senderId;
  }

  const digits = normalizePhone(senderId);
  if (!digits) {
    return senderId;
  }

  return senderId.includes("@") ? senderId : `${digits}@c.us`;
}

function readTextFromContainer(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return firstString(
    record.text,
    record.body,
    record.conversation,
    asRecord(record.extendedTextMessage)?.text,
    asRecord(record.imageMessage)?.caption,
    asRecord(record.videoMessage)?.caption,
    asRecord(record.documentMessage)?.caption,
  );
}

function readMentionIdsFromContainer(value: unknown): string[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const contextInfo = asRecord(record.contextInfo);
  return collectMentionIds(record.mentionedJid, contextInfo?.mentionedJid);
}

function getWebhookEnvelope(raw: unknown): { envelope: UnknownRecord; payload: UnknownRecord } | null {
  const envelope = asRecord(raw);
  if (!envelope) {
    return null;
  }

  return {
    envelope,
    payload:
      asRecord(envelope.payload) ??
      asRecord(envelope.data) ??
      asRecord(envelope.message) ??
      asRecord(envelope.eventData) ??
      envelope,
  };
}

export function getWebhookEventType(raw: unknown): string | undefined {
  const extracted = getWebhookEnvelope(raw);
  if (!extracted) {
    return undefined;
  }

  return firstString(
    extracted.envelope.event,
    extracted.envelope.type,
    extracted.payload.event,
    extracted.payload.type,
  );
}

export function normalizeWebhookInboundMessage(raw: unknown, botMentionAliases: string[] = []): NormalizedInboundEvent | null {
  const extracted = getWebhookEnvelope(raw);
  if (!extracted) {
    return null;
  }

  const eventType = getWebhookEventType(raw);
  if (eventType !== "message.received") {
    return null;
  }

  const message = asRecord(extracted.payload.message);
  const key = asRecord(message?.key);
  const messageContextInfo = asRecord(asRecord(message?.extendedTextMessage)?.contextInfo) ?? asRecord(message?.contextInfo);
  const payloadContextInfo = asRecord(extracted.payload.contextInfo);
  const chatId = firstString(
    extracted.payload.chatId,
    extracted.payload.remoteJid,
    extracted.payload.from,
    extracted.payload.to,
    message?.chatId,
    key?.remoteJid,
  );
  const senderIdRaw = firstString(
    extracted.payload.senderId,
    extracted.payload.author,
    extracted.payload.participant,
    extracted.payload.from,
    message?.senderId,
    key?.participant,
    key?.remoteJid,
  );
  const text = firstString(
    extracted.payload.text,
    extracted.payload.body,
    extracted.payload.messageText,
    readTextFromContainer(extracted.payload.message),
    readTextFromContainer(extracted.payload),
  );

  if (!chatId || !senderIdRaw || !text) {
    return null;
  }

  const quotedMessageId =
    firstString(
      payloadContextInfo?.stanzaId,
      messageContextInfo?.stanzaId,
      extracted.payload.quotedMessageId,
      extracted.payload.quotedMsgId,
      extracted.payload.replyToMessageId,
    ) ?? undefined;
  const quotedParticipantId =
    firstString(
      payloadContextInfo?.participant,
      messageContextInfo?.participant,
      extracted.payload.quotedParticipant,
    ) ?? undefined;
  const quotedText =
    readTextFromContainer(extracted.payload.quotedMessage) ??
    readTextFromContainer(payloadContextInfo?.quotedMessage) ??
    readTextFromContainer(messageContextInfo?.quotedMessage) ??
    firstString(extracted.payload.quotedText, extracted.payload.quotedBody) ??
    undefined;

  // #region debug-point A:webhook-quoted-shape
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
        hypothesisId: "A",
        location: "eventNormalizer.ts:normalizeWebhookInboundMessage",
        msg: "[DEBUG] Raw quoted reply webhook candidates",
        data: {
          eventType,
          chatId,
          senderIdRaw,
          text,
          quotedStanzaId:
            quotedMessageId ?? null,
          quotedParticipant: quotedParticipantId ?? null,
          quotedText: quotedText ?? null,
          hasQuotedMessage:
            Boolean(extracted.payload.quotedMessage) ||
            Boolean(payloadContextInfo?.quotedMessage) ||
            Boolean(messageContextInfo?.quotedMessage) ||
            Boolean(quotedText),
          payloadKeys: Object.keys(extracted.payload).slice(0, 20),
          messageKeys: message ? Object.keys(message).slice(0, 20) : [],
          payloadContextInfoKeys: payloadContextInfo ? Object.keys(payloadContextInfo).slice(0, 20) : [],
          messageContextInfoKeys: messageContextInfo ? Object.keys(messageContextInfo).slice(0, 20) : [],
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  })();
  // #endregion

  const senderId = normalizeSenderId(senderIdRaw);
  const recipientId = firstString(
    extracted.payload.to,
    extracted.payload.recipientId,
    message?.to,
  );
  const messageId = firstString(
    extracted.payload.messageId,
    extracted.payload.id,
    message?.messageId,
    key?.id,
  );
  const timestampRaw = firstString(
    extracted.payload.occurredAt,
    extracted.payload.timestamp,
    extracted.payload.ts,
    extracted.envelope.occurredAt,
    extracted.envelope.timestamp,
  );
  const timestamp = timestampRaw ? Date.parse(timestampRaw) || Date.now() : Date.now();
  const mentionIds = collectMentionIds(
    extracted.payload.mentionedJid,
    asRecord(extracted.payload.contextInfo)?.mentionedJid,
    readMentionIdsFromContainer(extracted.payload.message),
    readMentionIdsFromContainer(extracted.payload),
  );
  const addressedToBot = isAddressedToBot(getChatType(chatId), recipientId, mentionIds, text, botMentionAliases);

  // #region debug-point B:normalized-quoted-gap
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
        hypothesisId: "B",
        location: "eventNormalizer.ts:normalizeWebhookInboundMessage",
        msg: "[DEBUG] Normalized event quoted-context availability",
        data: {
          messageId: messageId ?? `webhook-${timestamp}`,
          chatId,
          senderId,
          normalizedHasQuotedFields: Boolean(quotedMessageId || quotedText || quotedParticipantId),
          rawQuotedStanzaId: quotedMessageId ?? null,
          rawQuotedText: quotedText ?? null,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  })();
  // #endregion

  return {
    messageId: messageId ?? `webhook-${timestamp}`,
    waMessageId: messageId,
    sessionId: firstString(
      extracted.envelope.sessionId,
      extracted.envelope.session_id,
      extracted.payload.sessionId,
      extracted.payload.session_id,
    ),
    chatId,
    chatName: firstString(
      extracted.payload.chatName,
      extracted.payload.senderName,
      extracted.payload.pushName,
      extracted.payload.notifyName,
    ),
    chatType: getChatType(chatId),
    direction: "incoming",
    messageType:
      firstString(extracted.payload.messageType, extracted.payload.type) ??
      (asRecord(message?.imageMessage)
        ? "image"
        : asRecord(message?.videoMessage)
          ? "video"
          : asRecord(message?.documentMessage)
            ? "document"
            : "text"),
    senderId,
    recipientId: recipientId ?? chatId,
    senderPhone: getCanonicalPhoneCandidate(senderId),
    recipientPhone: getCanonicalPhoneCandidate(recipientId),
    canonicalPhone: normalizeChatIdentity(chatId, senderId).canonicalPhone,
    mentionIds,
    addressedToBot,
    text,
    quotedMessageId,
    quotedText,
    quotedParticipantId,
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
    status: firstString(extracted.payload.status),
    raw: {
      id: messageId ?? `webhook-${timestamp}`,
      sessionId: firstString(
        extracted.envelope.sessionId,
        extracted.envelope.session_id,
        extracted.payload.sessionId,
        extracted.payload.session_id,
      ),
      waMessageId: messageId,
      chatId,
      chatName: firstString(
        extracted.payload.chatName,
        extracted.payload.senderName,
        extracted.payload.pushName,
        extracted.payload.notifyName,
      ),
      from: senderId,
      to: recipientId ?? chatId,
      body: text,
      type:
        firstString(extracted.payload.messageType, extracted.payload.type) ??
        (asRecord(message?.imageMessage)
          ? "image"
          : asRecord(message?.videoMessage)
            ? "video"
            : asRecord(message?.documentMessage)
              ? "document"
              : "text"),
      direction: "incoming",
      timestamp,
      metadata: extracted.payload,
      status: firstString(extracted.payload.status),
      createdAt: new Date(timestamp).toISOString(),
    },
  };
}
