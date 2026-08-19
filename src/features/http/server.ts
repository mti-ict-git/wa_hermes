import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

import type { AppConfig } from "../../config/types";
import { isPrivateChat, normalizeRecentMessages } from "../openwa/eventNormalizer";
import type { OpenWAClient } from "../openwa/openwaClient";

function maskApiKey(value: string): string {
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export class AppServer {
  constructor(
    private readonly config: AppConfig,
    private readonly openwaClient: OpenWAClient,
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
            hermes: {
              baseUrl: this.config.hermes.baseUrl,
              mode: this.config.hermes.mode,
              apiKey: maskApiKey(this.config.hermes.apiKey),
            },
            openwa: {
              baseUrl: this.config.openwa.baseUrl,
              sessionId: this.config.openwa.sessionId,
              apiDocUrl: this.config.openwa.apiDocUrl,
              testNumber: this.config.openwa.testNumber,
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

      response.writeHead(404);
      response.end(JSON.stringify({ ok: false, error: "Not found" }));
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.server.port, this.config.server.host, () => {
        console.log(
          `App server listening on http://${this.config.server.host}:${this.config.server.port}`,
        );
        resolve();
      });
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
          normalizedMessages: normalizeRecentMessages(filteredMessages),
        }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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
