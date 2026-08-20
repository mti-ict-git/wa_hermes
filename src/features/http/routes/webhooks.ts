import type { IncomingMessage, ServerResponse } from "node:http";

import { getWebhookEventType, normalizeWebhookInboundMessage } from "../../openwa/eventNormalizer";
import type { MessagingService } from "../../openwa/messagingService";
import type { CommandRouter } from "../../inbound/commandRouter";
import type { Logger } from "../../logging/logger";
import type { IdentityResolver } from "../../policy/identityResolver";
import type { OpenWAConfig } from "../../../config/types";

interface WebhookHandlerDeps {
  identityResolver: IdentityResolver;
  commandRouter: CommandRouter;
  messagingService: MessagingService;
  logger: Logger;
  openwaConfig: OpenWAConfig;
}

interface WebhookProcessOptions {
  sendReply: boolean;
  source: "live" | "test";
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode);
  response.end(JSON.stringify(payload));
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function toHeaderRecord(headers: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      out[key] = value.join(", ");
    }
  }

  return out;
}

export async function processWebhookPayload(
  payload: unknown,
  deps: WebhookHandlerDeps,
  options: WebhookProcessOptions,
): Promise<Record<string, unknown>> {
  const eventType = getWebhookEventType(payload) ?? "unknown";
  const normalizedEvent = normalizeWebhookInboundMessage(payload, deps.openwaConfig.botMentionAliases);

  deps.logger.info("webhook_received", {
    source: options.source,
    eventType,
    chatId: normalizedEvent?.chatId,
    senderId: normalizedEvent?.senderId,
    messageId: normalizedEvent?.messageId,
    textPreview: normalizedEvent?.text.slice(0, 120),
  });

  if (!normalizedEvent) {
    deps.logger.info("webhook_normalize_skipped", {
      source: options.source,
      eventType,
    });

    return {
      ok: true,
      source: options.source,
      eventType,
      handled: false,
      skipped: true,
      reason: "Unsupported or non-message webhook payload.",
    };
  }

  if (normalizedEvent.chatType === "group" && !normalizedEvent.addressedToBot) {
    deps.logger.info("webhook_group_ignored", {
      source: options.source,
      eventType,
      chatId: normalizedEvent.chatId,
      messageId: normalizedEvent.messageId,
      reason: "Group message did not mention the bot.",
    });

    return {
      ok: true,
      source: options.source,
      eventType,
      handled: false,
      skipped: true,
      reason: "Group message did not mention the bot.",
      normalizedEvent: {
        chatId: normalizedEvent.chatId,
        senderId: normalizedEvent.senderId,
        messageId: normalizedEvent.messageId,
        text: normalizedEvent.text,
        chatType: normalizedEvent.chatType,
        addressedToBot: normalizedEvent.addressedToBot,
      },
    };
  }

  const identity = await deps.identityResolver.resolveFromEvent(normalizedEvent);
  const routingResult = await deps.commandRouter.route({
    event: normalizedEvent,
    identity,
    sendAcknowledgement:
      options.sendReply
        ? async (text: string) => {
            await deps.messagingService.sendText(normalizedEvent.chatId, text);
          }
        : undefined,
  });

  let deliveryMode: "reply" | "send-text" | "none" = "none";
  if (options.sendReply && routingResult.reply.trim().length > 0) {
    deliveryMode = await deps.messagingService.sendReplyOrText(
      normalizedEvent.chatId,
      normalizedEvent.waMessageId,
      routingResult.reply,
    );
  }

  deps.logger.info("webhook_processed", {
    source: options.source,
    eventType,
    route: routingResult.route,
    handled: true,
    sentReply: options.sendReply && routingResult.reply.trim().length > 0,
    deliveryMode,
    handledLocally: routingResult.handledLocally,
  });

  return {
    ok: true,
    source: options.source,
    eventType,
    handled: true,
    sentReply: options.sendReply && routingResult.reply.trim().length > 0,
    deliveryMode,
    normalizedEvent: {
      chatId: normalizedEvent.chatId,
      senderId: normalizedEvent.senderId,
      messageId: normalizedEvent.messageId,
      text: normalizedEvent.text,
      chatType: normalizedEvent.chatType,
      addressedToBot: normalizedEvent.addressedToBot,
      mentionIds: normalizedEvent.mentionIds,
    },
    identity: {
      role: identity.role,
      isRegisteredUser: identity.isRegisteredUser,
      isTechnician: identity.isTechnician,
      canonicalPhone: identity.canonicalPhone,
    },
    routingResult,
  };
}

export async function handleOpenWAWebhookPayload(
  payload: unknown,
  response: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<boolean> {
  try {
    const result = await processWebhookPayload(payload, deps, { sendReply: true, source: "live" });

    writeJson(response, 202, result);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error("webhook_process_failed", {
      error,
    });
    writeJson(response, 500, {
      ok: false,
      error: message,
    });
    return false;
  }
}

export async function handleOpenWAWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<boolean> {
  try {
    const rawBody = await readRequestBody(request);
    const payload = rawBody.trim().length > 0 ? (JSON.parse(rawBody) as unknown) : {};
    return await handleOpenWAWebhookPayload(payload, response, deps);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error("webhook_request_failed", {
      error,
      headers: toHeaderRecord(request.headers),
    });
    writeJson(response, 500, {
      ok: false,
      error: message,
      headers: toHeaderRecord(request.headers),
    });
    return false;
  }
}

export async function handleWebhookTest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<void> {
  try {
    const rawBody = await readRequestBody(request);
    const bodyValue = rawBody.trim().length > 0 ? (JSON.parse(rawBody) as { payload?: unknown; sendReply?: boolean }) : {};
    if (bodyValue.payload === undefined) {
      writeJson(response, 400, {
        ok: false,
        error: "payload is required",
      });
      return;
    }

    const result = await processWebhookPayload(bodyValue.payload, deps, {
      sendReply: bodyValue.sendReply === true,
      source: "test",
    });

    writeJson(response, 202, result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error("webhook_test_failed", {
      error,
    });
    writeJson(response, 500, {
      ok: false,
      error: message,
    });
  }
}
