import { loadConfig } from "./config/env";
import { HelpdeskBroker } from "./features/hermes/helpdeskBroker";
import { HermesClient } from "./features/hermes/hermesClient";
import { CommandRouter } from "./features/inbound/commandRouter";
import { RouteClassifier } from "./features/inbound/routeClassifier";
import type { OpenWAMessage } from "./features/openwa/types";
import type { NormalizedInboundEvent } from "./features/openwa/types";
import { AccessPolicy } from "./features/policy/accessPolicy";
import { IdentityResolver } from "./features/policy/identityResolver";
import { HermesSessionStore } from "./features/state/hermesSessionStore";

function buildEvent(chatId: string, messageId: string, text: string): NormalizedInboundEvent {
  const timestamp = Date.now();
  const raw: OpenWAMessage = {
    id: messageId,
    chatId,
    from: chatId,
    to: chatId,
    body: text,
    type: "chat",
    direction: "incoming",
    timestamp,
  };

  return {
    messageId,
    chatId,
    chatType: "private",
    direction: "incoming",
    messageType: "chat",
    senderId: chatId,
    recipientId: chatId,
    text,
    timestamp,
    raw,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const resolver = new IdentityResolver(config.ldap, config.policy);
  const router = new CommandRouter(
    new AccessPolicy(),
    new RouteClassifier(),
    new HelpdeskBroker(new HermesClient(config.hermes), new HermesSessionStore()),
  );

  const chatId = "6281296827466@c.us";
  const identity = await resolver.resolve({ chatId, senderId: chatId });

  const safeCommand = await router.route({
    identity,
    event: buildEvent(chatId, "evt-safe", "/help"),
  });

  const deniedTechnician = await router.route({
    identity,
    event: buildEvent(chatId, "evt-tech", "/finduser widji"),
  });

  const deniedHighSensitivity = await router.route({
    identity,
    event: buildEvent(chatId, "evt-laps", "/getlaps pc-001"),
  });

  const hermesFreeText = await router.route({
    identity,
    event: buildEvent(chatId, "evt-free", "Halo helpdesk, koneksi VPN saya sering putus. Tolong bantu arahkan langkah awal."),
  });

  console.log(
    JSON.stringify(
      {
        safeCommand,
        deniedTechnician,
        deniedHighSensitivity,
        hermesFreeText,
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
