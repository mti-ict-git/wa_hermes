# Implementation Roadmap

## Purpose
Define the execution sequence for the WhatsApp helpdesk bridge project so implementation can proceed in small, verifiable phases without drifting from the documented design.

## Active Phase: Phase 8 - Command Safety and Routing

### Objective
Implement the local routing layer that separates conversational helpdesk, safe commands, technician commands, and blocked requests.

### Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/open-questions-and-challenges.md`

### Checklist
- [ ] Implement slash-command parsing.
- [ ] Implement route classification for blocked, local, and Hermes paths.
- [ ] Add the initial safe command set.
- [ ] Add technician-only command gating stubs.
- [ ] Keep high-sensitivity commands disabled by default.
- [ ] Add audit logging for allow/deny decisions.

### Output
- `src/features/inbound/commandParser.ts`
- `src/features/inbound/routeClassifier.ts`
- `src/features/inbound/commandRouter.ts`

### Challenge / Verification
- Safe command works for a regular private user.
- Technician-only command is denied for a regular user.
- High-sensitivity command remains disabled.
- Free-text helpdesk message routes to Hermes.

## Delivery Status

| Phase | Name | Status | Notes |
|---|---|---|---|
| 1 | Hermes CLI Session Persistence | Completed | Local Hermes helper can preserve session continuity. |
| 2 | WhatsApp Helpdesk Design | Completed | Core architecture, policy, and role model are documented. |
| 3 | Minimal OpenWA Helpdesk Harness | Completed | Manual OpenWA to Hermes relay was validated end-to-end. |
| 4 | TypeScript Foundation | Completed | TypeScript scaffold, config, and debug server are verified. |
| 5 | OpenWA Ingress and Normalization | Completed | TypeScript transport, normalization, and debug routes are verified. |
| 6 | Identity and Access Policy | Completed | AD eligibility, technician lookup, and local gating are verified. |
| 7 | Hermes Broker and Session Store | Completed | TypeScript broker continuity, dry-run, and reset flow are verified. |
| 8 | Command Safety and Routing | Active | Split safe, self-service, and restricted commands. |
| 9 | Webhook-Driven End-to-End Flow | Pending | Receive real inbound events and reply automatically. |
| 10 | Hardening and Operations | Pending | Logging, audit, deployment, and recovery readiness. |

## Completed Phases

### Phase 1 - Hermes CLI Session Persistence

#### Objective
Enable the local Hermes helper to preserve conversation continuity and support both sync and async execution paths for direct operator testing.

#### Source Documents
- `AGENTS.md`
- `docs/technical-implementation-plan.md`

#### Checklist
- [x] Document the local session persistence approach for the CLI helper.
- [x] Persist Hermes `session_id` between separate invocations.
- [x] Add session reset capability for fresh conversations.
- [x] Support sync and async request modes for operator testing.
- [x] Record verification evidence in the roadmap.

#### Output
- `chat_hermes.py`
- `.chat_hermes_state.json`

#### Challenge / Verification
- `python chat_hermes.py --new "Ingat kode ini untuk sesi ini: TEST-4401. Balas hanya ACK"` returned `ACK`.
- `python chat_hermes.py "Apa kode yang saya minta ingat di sesi ini? Jawab hanya kodenya saja."` returned `TEST-4401`.
- Resetting the local state started a fresh session.
- Async runs were verified for tool-heavy prompts.

### Phase 2 - WhatsApp Helpdesk Design

#### Objective
Define the target architecture, policy boundaries, and role model for the WhatsApp helpdesk bridge before implementation begins.

#### Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/technical-implementation-plan.md`

#### Checklist
- [x] Document the target architecture for the WhatsApp helpdesk channel.
- [x] Define the identity and authorization model for AD-eligible users and technicians.
- [x] Define the command safety model with deny-by-default behavior.
- [x] Define the `OpenWA -> Hermes marisa` integration boundary.
- [x] Record design-phase verification evidence and sync related docs.

#### Output
- `docs/helpdesk-whatsapp-design.md`
- Updated root roadmap and supporting docs

#### Challenge / Verification
- Hermes profile isolation was verified on `http://10.60.10.59:8643`.
- The `marisa` profile was confirmed to be separate from the default profile.
- Design decisions for private chat gating, technician role handling, and restricted commands were captured in the docs.

### Phase 3 - Minimal OpenWA Helpdesk Harness

#### Objective
Create a fast, low-risk validation harness that can inspect recent OpenWA messages, relay selected private messages to Hermes, and optionally send the response back to WhatsApp.

#### Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/technical-implementation-plan.md`

#### Checklist
- [x] Discover the live OpenWA auth and message endpoint contract.
- [x] Implement a local harness for recent-message inspection and Hermes relay.
- [x] Persist Hermes session state per WhatsApp `chatId`.
- [x] Keep the harness limited to private-chat relay and sending.
- [x] Verify the harness against live OpenWA and Hermes endpoints and sync docs.

#### Output
- `openwa_helpdesk_test.py`
- `.openwa_hermes_state.json`
- Updated root roadmap and supporting docs

#### Challenge / Verification
- OpenWA auth was verified to use `X-API-Key`.
- OpenWA session `9a73ada7-4893-44ae-8cdd-5f0f13957821` returned status `ready`.
- `python openwa_helpdesk_test.py recent --limit 3` returned recent messages.
- `python openwa_helpdesk_test.py relay --chat-id "6280000000000@c.us" --message "Ingat kode sesi ini: WA-4421. Balas hanya ACK." --new` returned `ACK`.
- `python openwa_helpdesk_test.py relay --chat-id "6280000000000@c.us" --message "Apa kode sesi yang saya minta ingat? Balas hanya kodenya."` returned `WA-4421`.
- A real outbound test message was sent successfully to the configured private test number through OpenWA.

### Phase 4 - TypeScript Foundation

#### Objective
Stand up the TypeScript runtime, configuration model, and application skeleton that all later phases will build on.

#### Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/technical-implementation-plan.md`
- `docs/open-questions-and-challenges.md`

#### Checklist
- [x] Initialize `package.json` and TypeScript toolchain.
- [x] Create `tsconfig.json` with project-appropriate compiler settings.
- [x] Add a typed config module that loads Hermes and OpenWA env values.
- [x] Define a first-pass module structure under `src/`.
- [x] Add build, typecheck, and lint commands.
- [x] Add a simple startup path to verify config load and app boot.

#### Output
- `package.json`
- `tsconfig.json`
- `.eslintrc.cjs`
- `src/index.ts`
- `src/config/*`
- `src/features/http/server.ts`
- `src/features/openwa/*`
- `src/features/policy/*`
- `src/features/hermes/*`
- `src/features/inbound/*`
- `src/features/state/*`

#### Challenge / Verification
- `npm install` succeeded on Node `v22.14.0`.
- `npm run lint` succeeded.
- `npm run typecheck` succeeded.
- `npm run build` succeeded.
- `node dist/index.js` started successfully after startup was decoupled from a mandatory OpenWA fetch.
- `GET http://127.0.0.1:8787/health` returned `ok: true` with Hermes and OpenWA config summary.
- `GET http://127.0.0.1:8787/debug/config` returned masked Hermes/OpenWA configuration values.
- `GET http://127.0.0.1:8787/debug/openwa-session` returned the live OpenWA session with status `ready`.

### Phase 5 - OpenWA Ingress and Normalization

#### Objective
Implement the TypeScript integration points for OpenWA transport and normalized inbound events, replacing the manual Python relay path with the first application-native transport layer.

#### Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/technical-implementation-plan.md`
- `docs/open-questions-and-challenges.md`

#### Checklist
- [x] Add an OpenWA client for authenticated API calls.
- [x] Implement message retrieval helpers needed for controlled testing.
- [x] Define normalized inbound event types.
- [x] Implement chat id and phone normalization utilities.
- [x] Add outbound `send-text` support in TypeScript.
- [x] Add a read-only debug route or CLI path for recent messages.
- [x] Record verification evidence and sync related docs.

#### Output
- `src/features/openwa/openwaClient.ts`
- `src/features/openwa/types.ts`
- `src/features/openwa/eventNormalizer.ts`
- `src/features/openwa/messagingService.ts`
- `src/features/http/server.ts`
- Updated root docs

#### Challenge / Verification
- `npm run lint` succeeded after the transport and normalization updates.
- `npm run typecheck` succeeded after the transport and normalization updates.
- `npm run build` succeeded after the transport and normalization updates.
- `GET http://127.0.0.1:8787/debug/openwa-session` returned the live OpenWA session with status `ready`.
- `GET http://127.0.0.1:8787/debug/openwa-messages?limit=3&incomingOnly=true` returned recent raw and normalized messages, including incoming private `@lid` chats classified as `private`.
- A direct TypeScript client call to `getSession()` returned session `wa-kantor` with status `ready`.
- A direct TypeScript client call to `getRecentMessages(3)` returned three recent messages from the live OpenWA session.
- A direct TypeScript client call to `sendText("6285712612218@c.us", "Phase 5 TypeScript send-text verification ...")` returned a message id and timestamp from OpenWA.

### Phase 6 - Identity and Access Policy

#### Objective
Implement the local authorization boundary so WhatsApp traffic is filtered before it reaches Hermes or sensitive commands.

#### Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/open-questions-and-challenges.md`

#### Checklist
- [x] Implement `identityResolver` for canonical sender identity.
- [x] Integrate AD eligibility lookup based on mobile + `mail`.
- [x] Integrate technician lookup from technician contacts.
- [x] Implement `accessPolicy` with deny-by-default behavior.
- [x] Encode private-chat-only rules for user helpdesk.
- [x] Return structured deny reasons for logging and operator messaging.

#### Output
- `src/config/env.ts`
- `src/config/types.ts`
- `src/features/policy/identityResolver.ts`
- `src/features/policy/accessPolicy.ts`
- `src/features/policy/ldapDirectory.ts`
- `src/features/policy/technicianDirectory.ts`
- `src/features/http/server.ts`
- Updated root docs

#### Challenge / Verification
- `npm install` succeeded after adding the LDAP runtime dependency.
- `npm run lint` succeeded after the policy and LDAP updates.
- `npm run typecheck` succeeded after the policy and LDAP updates.
- `npm run build` succeeded after the policy and LDAP updates.
- A direct TypeScript resolver lookup for a known technician private sender (`62857xxxx2218`) resolved to role `technician`, matched a non-empty AD `mail`, and was allowed to run a technician-only command in private chat.
- A direct TypeScript resolver lookup for a known AD-backed non-technician private sender (`62812xxxx7466`) resolved to role `user`, matched a non-empty AD `mail`, and was allowed to continue to `hermes_helpdesk_chat`.
- A direct TypeScript resolver lookup for `6280000000000@c.us` resolved to role `unregistered` and was denied with the not-registered operator message.
- A direct TypeScript resolver lookup for the same known regular user in group context (`120363193119024819@g.us`) was denied with the private-chat-only policy.

### Phase 7 - Hermes Broker and Session Store

#### Objective
Replace the Python relay logic with a TypeScript broker that talks to `marisa` and preserves Hermes continuity per WhatsApp chat.

#### Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/technical-implementation-plan.md`

#### Checklist
- [x] Implement a Hermes API client in TypeScript.
- [x] Implement per-chat session storage for `session_key` and `session_id`.
- [x] Build the helpdesk broker prompt contract.
- [x] Default the broker to the stable sync request path.
- [x] Add safe session reset capability for test and support flows.
- [x] Add structured logging for Hermes request/response boundaries.

#### Output
- `src/features/hermes/hermesClient.ts`
- `src/features/hermes/helpdeskBroker.ts`
- `src/features/state/hermesSessionStore.ts`
- Updated root docs

#### Challenge / Verification
- `npm run lint` succeeded after the Hermes broker and session-store updates.
- `npm run typecheck` succeeded after the Hermes broker and session-store updates.
- `npm run build` succeeded after the Hermes broker and session-store updates.
- A direct TypeScript broker call for private chat `62857xxxx2218@c.us` returned `ACK` for the first turn and reused the same Hermes `session_id` on the second turn, which returned `TS7-991`.
- A direct TypeScript broker call for separate private chat `62812xxxx7466@c.us` returned `NOSESSION` with a different Hermes `session_id`, confirming chats do not share continuity.
- A direct TypeScript broker call with `dryRun: true` returned a reply without mutating the stored session state for the active chat.
- A broker reset for `62857xxxx2218@c.us` rotated the local session mapping to an isolated reset key, and the next turn returned `NOSESSION` with a fresh Hermes `session_id`.

## Planned Phases

### Phase 8 - Command Safety and Routing

#### Objective
Implement the local routing layer that separates conversational helpdesk, safe commands, technician commands, and blocked requests.

#### Source Documents
- `docs/helpdesk-whatsapp-design.md`
- `docs/open-questions-and-challenges.md`

#### Checklist
- [ ] Implement slash-command parsing.
- [ ] Implement route classification for blocked, local, and Hermes paths.
- [ ] Add the initial safe command set.
- [ ] Add technician-only command gating stubs.
- [ ] Keep high-sensitivity commands disabled by default.
- [ ] Add audit logging for allow/deny decisions.

#### Output
- `src/features/inbound/commandParser.ts`
- `src/features/inbound/routeClassifier.ts`
- `src/features/inbound/commandRouter.ts`

#### Dependencies
- Completed Phase 6 identity and policy
- Completed Phase 7 Hermes broker

#### Challenge / Verification
- Safe command works for a regular private user.
- Technician-only command is denied for a regular user.
- High-sensitivity command remains disabled.
- Free-text helpdesk message routes to Hermes.

### Phase 9 - Webhook-Driven End-to-End Flow

#### Objective
Move from manual relay to automatic inbound processing from OpenWA webhooks.

#### Source Documents
- `docs/helpdesk-whatsapp-design.md`
- `docs/technical-implementation-plan.md`

#### Checklist
- [ ] Implement the webhook HTTP endpoint in TypeScript.
- [ ] Validate incoming session and event shape.
- [ ] Normalize supported inbound message events.
- [ ] Route private inbound messages through policy and broker.
- [ ] Send the final reply back via OpenWA.
- [ ] Document webhook registration and local run instructions.

#### Output
- `src/features/http/routes/webhooks.ts`
- `src/features/http/server.ts`
- updated docs for runtime and testing

#### Dependencies
- Completed Phase 5 OpenWA ingress
- Completed Phase 6 identity and policy
- Completed Phase 7 Hermes broker
- Completed Phase 8 command routing

#### Challenge / Verification
- A real inbound private WhatsApp message reaches the app through webhook delivery.
- The app classifies, processes, and replies automatically.
- Repeated messages in the same chat retain Hermes continuity.

### Phase 10 - Hardening and Operations

#### Objective
Prepare the TypeScript service for repeatable deployment, support, and safer production behavior.

#### Source Documents
- `docs/helpdesk-whatsapp-design.md`
- `docs/technical-implementation-plan.md`
- `docs/open-questions-and-challenges.md`

#### Checklist
- [ ] Add structured application logging.
- [ ] Add error handling and retry policy for Hermes and OpenWA failures.
- [ ] Add audit/event logging for restricted command decisions.
- [ ] Define the initial deployment shape and required env vars.
- [ ] Define session-state storage evolution path beyond local file storage.
- [ ] Document operational runbook items for restart, webhook recovery, and message replay.

#### Output
- logging/audit modules
- deployment and runbook docs
- finalized env documentation

#### Dependencies
- Completed Phase 9 webhook flow

#### Challenge / Verification
- Service starts from a clean environment with documented env vars.
- Failure paths produce readable logs.
- Recovery steps are documented and dry-run checked.

## Cross-Phase Rules
- Do not route restricted commands to Hermes before local policy evaluation.
- Do not enable group-chat helpdesk for regular users unless the design docs are updated first.
- Do not enable high-sensitivity commands by default.
- Keep the production implementation in TypeScript.
- Keep Python helpers as temporary validation tools only.

## Current Risks
- AD and technician-contact integration details are still implementation-time unknowns in this repository.
- The `marisa` profile currently behaves reliably on sync requests, while async `/v1/runs` is not yet the stable default.
- Session storage is currently file-based in the temporary harness and will need a TypeScript equivalent first, with a likely later move to a stronger store if traffic grows.

## Next Decision Gate
Before starting Phase 8 execution, the repository should have:
- a working TypeScript scaffold
- typed configuration for Hermes and OpenWA
- a defined `src/` module layout
- successful build/typecheck evidence captured in this roadmap
- Phase 7 marked complete with synchronized supporting docs
