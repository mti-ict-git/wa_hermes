import { createRootLogger } from "./features/logging/logger";
import { HermesClient } from "./features/hermes/hermesClient";
import { HelpdeskBroker } from "./features/hermes/helpdeskBroker";
import { CommandRouter } from "./features/inbound/commandRouter";
import { RouteClassifier } from "./features/inbound/routeClassifier";
import { OpenWAClient } from "./features/openwa/openwaClient";
import { AccessPolicy } from "./features/policy/accessPolicy";
import type { IdentityContext } from "./features/policy/identityResolver";
import { HermesSessionStore } from "./features/state/hermesSessionStore";
import { loadConfig } from "./config/env";
import type { NormalizedInboundEvent, OpenWAMessage } from "./features/openwa/types";

function buildBlockedEvent(chatId: string, text: string): NormalizedInboundEvent {
  const timestamp = Date.now();
  const raw: OpenWAMessage = {
    id: "phase10-blocked-001",
    chatId,
    from: chatId,
    to: chatId,
    body: text,
    type: "chat",
    direction: "incoming",
    timestamp,
  };

  return {
    messageId: raw.id,
    chatId,
    chatType: "private",
    direction: "incoming",
    messageType: "chat",
    senderId: chatId,
    recipientId: chatId,
    addressedToBot: true,
    text,
    timestamp,
    raw,
  };
}

async function expectFailure(label: string, callback: () => Promise<unknown>): Promise<string> {
  try {
    await callback();
    return `${label}:unexpected-success`;
  } catch (error: unknown) {
    return `${label}:${error instanceof Error ? error.message : String(error)}`;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createRootLogger({ level: "debug", format: "pretty" });

  const blockedIdentity: IdentityContext = {
    chatId: "6281296827466@c.us",
    chatType: "private",
    sourceId: "6281296827466@c.us",
    canonicalPhone: "6281296827466",
    adUser: null,
    technicianContact: null,
    hasRequiredMail: true,
    isRegisteredUser: true,
    isTechnician: false,
    role: "user",
    resolutionReason: "Phase 10 blocked-command verification identity.",
  };

  const router = new CommandRouter(
    new AccessPolicy(),
    new RouteClassifier(),
    new HelpdeskBroker(
      new HermesClient(config.hermes, logger.child("verify.router.hermes")),
      new HermesSessionStore(),
      logger.child("verify.router.broker"),
    ),
    logger.child("verify.router"),
  );

  const blockedResult = await router.route({
    identity: blockedIdentity,
    event: buildBlockedEvent(blockedIdentity.chatId, "/getlaps pc-001"),
  });

  const hermesFailure = await expectFailure("hermes", async () => {
    const failingHermesClient = new HermesClient(
      {
        ...config.hermes,
        baseUrl: "http://127.0.0.1:1",
        retryPolicy: {
          maxAttempts: 2,
          delayMs: 50,
          timeoutMs: 300,
        },
      },
      logger.child("verify.hermes"),
    );

    await failingHermesClient.chat({
      sessionKey: "phase10-failure-hermes",
      message: "health check",
    });
  });

  const openwaFailure = await expectFailure("openwa", async () => {
    const failingOpenwaClient = new OpenWAClient(
      {
        ...config.openwa,
        baseUrl: "http://127.0.0.1:1",
        retryPolicy: {
          maxAttempts: 2,
          delayMs: 50,
          timeoutMs: 300,
        },
      },
      logger.child("verify.openwa"),
    );

    await failingOpenwaClient.getSession();
  });

  console.log(
    JSON.stringify(
      {
        blockedRoute: blockedResult.route,
        blockedReason: blockedResult.reason,
        hermesFailure,
        openwaFailure,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
