# Technical Implementation Plan

## Task
Define the implementation direction for two separate workstreams:
- local Hermes chat helper support
- dedicated WhatsApp helpdesk channel design
- minimal OpenWA helpdesk test harness

## Scope
- Keep the local helper support for `POST /v1/chat/completions` and `POST /v1/runs`.
- Add a design baseline for a dedicated WhatsApp helpdesk channel that routes to Hermes profile `marisa`.
- Keep local policy enforcement in the OpenWA layer.
- Restrict WhatsApp helpdesk eligibility to AD users with mobile match and non-empty `mail`.
- Restrict technician-only commands using technician contacts and private-chat-only policy.
- Add a temporary CLI harness that can inspect recent OpenWA messages and manually relay a selected private chat to Hermes.
- Define a trusted execution model where Marisa produces typed intents and the WhatsApp bridge remains the local executor.
- Use TypeScript for the project implementation path.

## Design
1. Preserve the existing local helper approach for direct Hermes testing.
2. Treat the WhatsApp helpdesk channel as a separate design track with its own policy and routing model.
3. Use a dedicated Hermes profile (`marisa`) on its own API port for WhatsApp helpdesk traffic.
4. Keep identity resolution, authorization, and command gating local to the OpenWA application.
5. Route only allowed conversational helpdesk traffic to Hermes.
6. Keep sensitive and high-impact commands denied until explicitly approved.
7. Use a temporary polling/manual relay harness for fast end-to-end testing before a fuller webhook implementation is added.
8. Persist Hermes `session_id` locally per WhatsApp `chatId` so repeated tests behave like one ongoing helpdesk conversation.
9. Keep the harness configurable for both sync and async Hermes requests, and make sure the request model name matches the dedicated profile (`marisa` by default).
10. Treat the current Python helpers as temporary validation tooling, not as the final application implementation language.
11. Create an HMAC-signed `AuthContext` from OpenWA metadata and local policy outputs before any model-assisted backend flow.
12. Use Marisa first for typed intent generation, then validate locally, execute approved read-only adapters, and use Marisa again only for final summarization.

## Planned TypeScript Shape
- `src/index.ts`: app bootstrap
- `src/config/`: env loading and typed config
- `src/features/openwa/`: OpenWA client, types, normalization, outbound messaging
- `src/features/policy/`: identity resolution and access policy
- `src/features/hermes/`: Hermes client and helpdesk broker
- `src/features/inbound/`: route classification and command routing
- `src/features/http/`: webhook server and debug routes
- `src/features/state/`: session storage and transient state helpers

## Current Implementation State
- Phases 4 through 10 are implemented and verified for the current roadmap scope.
- The next documented increment is a trusted typed-intent orchestration layer, not direct backend execution from the model.
- The app currently exposes:
  - `/health`
  - `/debug/config`
  - `/debug/openwa-session`
  - `/debug/openwa-messages`
  - `POST /webhooks/openwa`
  - `POST /channel/webhooks/openwa`
  - `POST /channel/webhooks/test`
- The OpenWA TypeScript client now supports:
  - session inspection
  - recent message retrieval
  - normalized message shaping for debug and downstream policy work
  - outbound `send-text`
  - outbound message reply by `quotedMessageId`
  - bounded retry and timeout handling for transient failures
- The policy layer now supports:
  - AD-backed sender lookup by normalized phone
  - technician-role lookup from the configured technician contacts JSON
  - role resolution into `unregistered`, `user`, and `technician`
  - private-chat-only enforcement for conversational helpdesk
  - deny-by-default handling for commands outside the allowed set
  - structured audit logging for allow and deny decisions
  - identity enrichment from AD and technician metadata for downstream helpdesk context
- The Hermes broker layer now supports:
  - runtime selection between sync `chat/completions` and async `runs` requests through `HERMES_MODE`
  - configurable Hermes model selection through `HERMES_MODEL` with `marisa` as the current default
  - per-chat `session_key` / `session_id` continuity in TypeScript
  - dry-run broker replies for safe operator verification
  - explicit session reset with isolated post-reset session keys
  - request/response boundary logging for Hermes calls
  - async run polling until a terminal `completed`, `failed`, or `cancelled` state is reached
  - bounded retry and timeout handling for transient failures
  - verified sender profile hints such as display name, title, department, employee ID, and technician metadata in the WhatsApp helpdesk prompt
- The next contract layer is now documented to require:
  - HMAC-signed `AuthContext`
  - typed intent parsing and validation
  - approved read-only local adapters for AD and Veeam
  - early ACK plus final summarized response flow
- The current codebase now implements the first runtime slice of that contract:
  - `AuthContext` HMAC creation and verification
  - typed intent generation plus validation
  - early ACK callback in the WhatsApp webhook path
  - read-only AD profile adapter for self-profile and user-profile lookup
  - fallback to the legacy conversational broker when no backend action is selected
- Remaining gap:
  - durable inbox/outbox for ACK and final response
  - Veeam adapter wiring
  - broader typed-intent coverage beyond the initial AD slice
- The inbound routing layer now supports:
  - slash-command parsing
  - route classification from policy outcome into blocked, silent-ignore, local, or Hermes flows
  - silent ignore for all slash commands in private chat
  - audit logging for allow and deny outcomes
- The HTTP webhook layer now supports:
  - webhook payload normalization into the internal message model
  - deduplication by inbound message id for `message.received`
  - in-flight duplicate suppression that only marks messages as processed after successful handling
  - outbound reply delivery with fallback from reply-to-message into plain `send-text`
  - silent ignore for ordinary group chatter unless the bot is explicitly mentioned
  - configurable group mention alias matching for LID-style bot tags through `OPENWA_BOT_MENTION_ALIASES`
- Startup no longer hard-fails on a mandatory OpenWA fetch; live OpenWA inspection is available through dedicated debug routes instead.
- Operational hardening now includes:
  - structured JSON logging
  - deployment and environment documentation
  - Docker packaging for the Node bridge service through `Dockerfile`, `.dockerignore`, and `docker-compose.yml`
  - day-2 runbook steps for restart, webhook recovery, and replay
  - an explicit state evolution path from memory to SQLite before any Redis adoption

## Milestone Mapping
- Foundation milestone: Phase 4
- Transport milestone: Phase 5
- Authorization milestone: Phase 6
- Conversation milestone: Phase 7
- Routing milestone: Phase 8
- Automatic inbound milestone: Phase 9
- Operations milestone: Phase 10 (completed)
- Next orchestration milestone: typed intent + `AuthContext` + local adapter execution

## Source-of-Truth Note
Implementation work in this repository should follow the root `docs/` documents. External study material may inform decisions, but it is not part of the working source of truth for this repo.

## Non-Goals
- No forced merge between the main Hermes profile and the WhatsApp helpdesk profile.
- No direct exposure of unrestricted Hermes tools to WhatsApp users.
- No WhatsApp implementation changes in this document-only phase.
