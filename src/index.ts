import { loadConfig } from "./config/env";
import { AppServer } from "./features/http/server";
import { AdReadOnlyAdapter } from "./features/adapters/adReadOnlyAdapter";
import { HermesClient } from "./features/hermes/hermesClient";
import { HelpdeskBroker } from "./features/hermes/helpdeskBroker";
import { CommandRouter } from "./features/inbound/commandRouter";
import { IntentValidator } from "./features/inbound/intentValidator";
import { RouteClassifier } from "./features/inbound/routeClassifier";
import { createRootLogger } from "./features/logging/logger";
import { OpenWAClient } from "./features/openwa/openwaClient";
import { MessagingService } from "./features/openwa/messagingService";
import { AccessPolicy } from "./features/policy/accessPolicy";
import { IdentityResolver } from "./features/policy/identityResolver";
import { LdapDirectory } from "./features/policy/ldapDirectory";
import { AuthContextService } from "./features/security/authContext";
import { HermesSessionStore } from "./features/state/hermesSessionStore";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createRootLogger(config.logging);
  const openwaClient = new OpenWAClient(config.openwa, logger.child("openwa"));
  const hermesClient = new HermesClient(config.hermes, logger.child("hermes"));
  const sessionStore = new HermesSessionStore();
  const routeClassifier = new RouteClassifier();
  const accessPolicy = new AccessPolicy();
  const authContextService = new AuthContextService(config.policy.authContextSecret, {
    ttlSeconds: config.policy.authContextTtlSeconds,
  });
  const intentValidator = new IntentValidator(authContextService);
  const adReadOnlyAdapter = new AdReadOnlyAdapter(new LdapDirectory(config.ldap), logger.child("ad-adapter"));
  const helpdeskBroker = new HelpdeskBroker(
    hermesClient,
    sessionStore,
    authContextService,
    intentValidator,
    adReadOnlyAdapter,
    config.policy.authContextPolicyVersion,
    logger.child("broker"),
  );
  const commandRouter = new CommandRouter(accessPolicy, routeClassifier, helpdeskBroker, logger.child("router"));
  const identityResolver = new IdentityResolver(config.ldap, config.policy);
  const messagingService = new MessagingService(openwaClient, logger.child("messaging"));

  const application = {
    commandRouter,
    routeClassifier,
    identityResolver,
    accessPolicy,
    messagingService,
    helpdeskBroker,
    server: new AppServer(
      config,
      openwaClient,
      identityResolver,
      commandRouter,
      messagingService,
      logger.child("server"),
    ),
  };

  void application.commandRouter;
  void application.routeClassifier;
  void application.identityResolver;
  void application.accessPolicy;
  void application.messagingService;
  void application.helpdeskBroker;

  await application.server.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      scope: "wa-plugin.bootstrap",
      event: "startup_failed",
      error: message,
    }),
  );
  process.exitCode = 1;
});
