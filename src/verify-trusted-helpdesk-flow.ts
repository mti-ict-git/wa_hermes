import { HelpdeskBroker } from "./features/hermes/helpdeskBroker";
import { IntentValidator } from "./features/inbound/intentValidator";
import type { IdentityContext } from "./features/policy/identityResolver";
import { AuthContextService } from "./features/security/authContext";
import { HermesSessionStore } from "./features/state/hermesSessionStore";

async function main(): Promise<void> {
  const authContextService = new AuthContextService("test-secret", {
    ttlSeconds: 120,
  });

  const fakeHermesClient = {
    async chat(request: { message: string; sessionKey: string; sessionId?: string }) {
      if (request.sessionKey.includes(":intent:")) {
        if (/siapa saya/i.test(request.message)) {
          return {
            content: JSON.stringify({
              intent_version: "v1",
              intent_name: "ad.get_self_profile",
              confidence: 0.96,
              target_scope: "self",
              target_ref: null,
              arguments: {
                fields: ["displayName", "mail", "title", "department", "role"],
              },
              request_id: request.message.match(/"request_id": "([^"]+)"/)?.[1] ?? "unknown",
            }),
            sessionId: request.sessionId,
            raw: {},
          };
        }

        return {
          content: JSON.stringify({
            intent_version: "v1",
            intent_name: "helpdesk.no_backend_action",
            confidence: 0.8,
            target_scope: "no_target",
            target_ref: null,
            arguments: {},
            request_id: request.message.match(/"request_id": "([^"]+)"/)?.[1] ?? "unknown",
          }),
          sessionId: request.sessionId,
          raw: {},
        };
      }

      if (/safe_result_json:/i.test(request.message)) {
        return {
          content: "Profil Anda: displayName Widji Santoso, mail widji@example.com, title Technician, department ICT, role technician.",
          sessionId: "session-summary",
          raw: {},
        };
      }

      return {
        content: "Halo, ini fallback conversation lama.",
        sessionId: "session-legacy",
        raw: {},
      };
    },
  };

  const fakeAdAdapter = {
    async getSelfProfile(identity: IdentityContext) {
      return {
        success: true,
        code: "ok" as const,
        safeResult: {
          displayName: identity.adUser?.displayName ?? "Widji Santoso",
          mail: identity.adUser?.mail ?? "widji@example.com",
          title: identity.adUser?.title ?? "Technician",
          department: identity.adUser?.department ?? "ICT",
          role: identity.role,
        },
      };
    },
    async lookupUserProfile(query: string) {
      return {
        success: true,
        code: "ok" as const,
        safeResult: {
          query,
          total: 1,
          matches: [
            {
              displayName: "Mahathir",
              mail: "mahathir@example.com",
            },
          ],
        },
      };
    },
    unsupported(intentName: string) {
      return {
        success: false,
        code: "unsupported" as const,
        safeResult: {
          intentName,
        },
      };
    },
  };

  const silentLogger = {
    info() {},
    warn() {},
    error() {},
  };

  const broker = new HelpdeskBroker(
    fakeHermesClient as never,
    new HermesSessionStore(),
    authContextService,
    new IntentValidator(authContextService),
    fakeAdAdapter as never,
    "2026-08-20",
    silentLogger as never,
  );

  const identity: IdentityContext = {
    chatId: "6285712612218@c.us",
    chatType: "private",
    sourceId: "6285712612218@c.us",
    canonicalPhone: "6285712612218",
    adUser: {
      displayName: "Widji Santoso",
      mail: "widji@example.com",
      title: "Technician",
      department: "ICT",
      employeeId: "12345",
      gender: "male",
    },
    technicianContact: null,
    hasRequiredMail: true,
    isRegisteredUser: true,
    isTechnician: true,
    role: "technician",
    resolutionReason: "verification",
  };

  let ackCount = 0;
  const profileResult = await broker.ask({
    chatId: identity.chatId,
    chatType: identity.chatType,
    senderId: identity.sourceId ?? identity.chatId,
    senderDisplayName: identity.adUser?.displayName,
    message: "siapa saya?",
    requestId: "req-profile",
    identity,
    onAcknowledgement: async () => {
      ackCount += 1;
    },
  });

  const fallbackResult = await broker.ask({
    chatId: identity.chatId,
    chatType: identity.chatType,
    senderId: identity.sourceId ?? identity.chatId,
    senderDisplayName: identity.adUser?.displayName,
    message: "tolong bantu rangkum chat ini",
    requestId: "req-fallback",
    identity,
  });

  console.log(
    JSON.stringify(
      {
        ackCount,
        profileResult: {
          orchestration: profileResult.orchestration,
          reply: profileResult.reply,
        },
        fallbackResult: {
          orchestration: fallbackResult.orchestration,
          reply: fallbackResult.reply,
        },
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
