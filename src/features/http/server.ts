import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppConfig } from "../../config/types";
import { handleOpenWAWebhookPayload, handleWebhookTest } from "./routes/webhooks";
import type { CommandRouter } from "../inbound/commandRouter";
import type { Logger } from "../logging/logger";
import { isPrivateChat, normalizeRecentMessages } from "../openwa/eventNormalizer";
import type { OpenWAClient } from "../openwa/openwaClient";
import type { MessagingService } from "../openwa/messagingService";
import type { IdentityResolver } from "../policy/identityResolver";

function maskApiKey(value: string): string {
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export class AppServer {
  private readonly processedMessageIds = new Set<string>();
  private readonly processingMessageIds = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly openwaClient: OpenWAClient,
    private readonly identityResolver: IdentityResolver,
    private readonly commandRouter: CommandRouter,
    private readonly messagingService: MessagingService,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      const requestUrl = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? `${this.config.server.host}:${this.config.server.port}`}`,
      );

      if (requestUrl.pathname === "/health") {
        response.writeHead(200);
        response.end(
          JSON.stringify({
            ok: true,
            appName: this.config.appName,
            environment: this.config.environment,
            hermesBaseUrl: this.config.hermes.baseUrl,
            hermesMode: this.config.hermes.mode,
            openwa: {
              baseUrl: this.config.openwa.baseUrl,
              sessionId: this.config.openwa.sessionId,
              connectivity: "not_checked_at_startup",
            },
          }),
        );
        return;
      }

      if (requestUrl.pathname === "/debug/openwa-session") {
        void this.handleOpenWASessionDebug(response);
        return;
      }

      if (requestUrl.pathname === "/debug/openwa-messages") {
        void this.handleOpenWAMessagesDebug(response, requestUrl.searchParams);
        return;
      }

      if (requestUrl.pathname === "/debug/config") {
        response.writeHead(200);
        response.end(
          JSON.stringify({
            appName: this.config.appName,
            environment: this.config.environment,
            server: this.config.server,
            logging: this.config.logging,
            hermes: {
              baseUrl: this.config.hermes.baseUrl,
              mode: this.config.hermes.mode,
              retryPolicy: this.config.hermes.retryPolicy,
              apiKey: maskApiKey(this.config.hermes.apiKey),
            },
            openwa: {
              baseUrl: this.config.openwa.baseUrl,
              sessionId: this.config.openwa.sessionId,
              apiDocUrl: this.config.openwa.apiDocUrl,
              testNumber: this.config.openwa.testNumber,
              retryPolicy: this.config.openwa.retryPolicy,
              apiKey: maskApiKey(this.config.openwa.apiKey),
            },
            ldap: {
              enabled: this.config.ldap.enabled,
              url: this.config.ldap.url,
              baseDn: this.config.ldap.baseDn,
              bindDn: this.config.ldap.bindDn,
              bindPassword: this.config.ldap.bindPassword ? maskApiKey(this.config.ldap.bindPassword) : undefined,
            },
            policy: {
              technicianContactsPath: this.config.policy.technicianContactsPath,
            },
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        (requestUrl.pathname === "/webhooks/openwa" || requestUrl.pathname === "/channel/webhooks/openwa")
      ) {
        void this.handleWebhookWithDedup(request, response);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/channel/webhooks/test") {
        void handleWebhookTest(request, response, {
          identityResolver: this.identityResolver,
          commandRouter: this.commandRouter,
          messagingService: this.messagingService,
          logger: this.logger.child("webhooks"),
          openwaConfig: this.config.openwa,
        });
        return;
      }

      response.writeHead(404);
      response.end(JSON.stringify({ ok: false, error: "Not found" }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.server.port, this.config.server.host, () => {
        this.logger.info("server_started", {
          host: this.config.server.host,
          port: this.config.server.port,
          environment: this.config.environment,
        });
        resolve();
      });
    });
  }

  private async handleWebhookWithDedup(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await this.readBodyForDedup(request);
    let eventType: string | undefined;
    let messageId: string | undefined;
    try {
      const payload = body.trim().length > 0 ? (JSON.parse(body) as unknown) : {};
      eventType = typeof payload === "object" && payload ? (payload as Record<string, unknown>).event as string | undefined : undefined;
      messageId = this.extractMessageId(payload);

      if (eventType === "message.received" && messageId && this.processedMessageIds.has(messageId)) {
        this.logger.warn("webhook_duplicate_skipped", {
          messageId,
          state: "processed",
        });
        response.writeHead(202);
        response.end(
          JSON.stringify({
            ok: true,
            duplicate: true,
            messageId,
          }),
        );
        return;
      }

      if (eventType === "message.received" && messageId && this.processingMessageIds.has(messageId)) {
        this.logger.warn("webhook_duplicate_skipped", {
          messageId,
          state: "in_flight",
        });
        response.writeHead(202);
        response.end(
          JSON.stringify({
            ok: true,
            duplicate: true,
            messageId,
          }),
        );
        return;
      }

      if (eventType === "message.received" && messageId) {
        this.processingMessageIds.add(messageId);
      }

      const succeeded = await handleOpenWAWebhookPayload(payload, response, {
        identityResolver: this.identityResolver,
        commandRouter: this.commandRouter,
        messagingService: this.messagingService,
        logger: this.logger.child("webhooks"),
        openwaConfig: this.config.openwa,
      });

      if (eventType === "message.received" && messageId) {
        this.processingMessageIds.delete(messageId);
        if (succeeded) {
          this.processedMessageIds.add(messageId);
        }
      }
    } catch (error: unknown) {
      if (eventType === "message.received" && messageId) {
        this.processingMessageIds.delete(messageId);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("webhook_dedup_pipeline_failed", {
        error,
      });
      response.writeHead(500);
      response.end(JSON.stringify({ ok: false, error: message }));
    }
  }

  private extractMessageId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }

    const record = payload as Record<string, unknown>;
    const nested =
      (record.payload as Record<string, unknown> | undefined) ??
      (record.data as Record<string, unknown> | undefined) ??
      record;
    const message = nested.message as Record<string, unknown> | undefined;
    const key = message?.key as Record<string, unknown> | undefined;

    const rawValue =
      (typeof nested.messageId === "string" ? nested.messageId : undefined) ??
      (typeof nested.id === "string" ? nested.id : undefined) ??
      (typeof message?.messageId === "string" ? message.messageId : undefined) ??
      (typeof key?.id === "string" ? key.id : undefined);

    return rawValue?.trim() || undefined;
  }

  private readBodyForDedup(request: IncomingMessage): Promise<string> {
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
  private async handleOpenWASessionDebug(response: ServerResponse): Promise<void> {
    try {
      const openwaSession = await this.openwaClient.getSession();
      response.writeHead(200);
      response.end(
        JSON.stringify({
          ok: true,
          openwaSession,
        }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("debug_openwa_session_failed", {
        error,
      });
      response.writeHead(502);
      response.end(
        JSON.stringify({
          ok: false,
          error: message,
        }),
      );
    }
  }

  private async handleOpenWAMessagesDebug(
    response: ServerResponse,
    searchParams: URLSearchParams,
  ): Promise<void> {
    try {
      const limit = this.parseLimit(searchParams.get("limit"));
      const incomingOnly = searchParams.get("incomingOnly") === "true";
      const privateOnly = searchParams.get("privateOnly") === "true";
      const recentMessages = await this.openwaClient.getRecentMessages(limit);
      const filteredMessages = recentMessages.messages.filter((message) => {
        if (incomingOnly && message.direction !== "incoming") {
          return false;
        }

        if (privateOnly && !isPrivateChat(message.chatId)) {
          return false;
        }

        return true;
      });

      response.writeHead(200);
      response.end(
        JSON.stringify({
          ok: true,
          limit,
          filters: {
            incomingOnly,
            privateOnly,
          },
          total: recentMessages.total,
          count: filteredMessages.length,
          messages: filteredMessages,
          normalizedMessages: normalizeRecentMessages(filteredMessages, this.config.openwa.botMentionAliases),
        }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("debug_openwa_messages_failed", {
        error,
      });
      response.writeHead(502);
      response.end(
        JSON.stringify({
          ok: false,
          error: message,
        }),
      );
    }
  }

  private parseLimit(rawValue: string | null): number {
    if (!rawValue) {
      return 10;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 10;
    }

    return Math.min(Math.floor(parsed), 50);
  }
}
