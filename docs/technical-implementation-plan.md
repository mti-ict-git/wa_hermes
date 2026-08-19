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
9. Default the harness to synchronous Hermes requests for the `marisa` profile because async `/v1/runs` is currently incompatible with that runtime/model setup.
10. Treat the current Python helpers as temporary validation tooling, not as the final application implementation language.

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
- The Phase 4 TypeScript scaffold is in place, Phase 5 transport wiring is implemented, Phase 6 policy foundations are active, and Phase 7 Hermes broker continuity is verified.
- The app currently exposes:
  - `/health`
  - `/debug/config`
  - `/debug/openwa-session`
  - `/debug/openwa-messages`
- The OpenWA TypeScript client now supports:
  - session inspection
  - recent message retrieval
  - normalized message shaping for debug and downstream policy work
  - outbound `send-text`
  - outbound message reply by `quotedMessageId`
- The policy layer now supports:
  - AD-backed sender lookup by normalized phone
  - technician-role lookup from the configured technician contacts JSON
  - role resolution into `unregistered`, `user`, and `technician`
  - private-chat-only enforcement for conversational helpdesk
  - deny-by-default handling for commands outside the allowed set
- The Hermes broker layer now supports:
  - sync `chat/completions` requests to the dedicated `marisa` profile
  - per-chat `session_key` / `session_id` continuity in TypeScript
  - dry-run broker replies for safe operator verification
  - explicit session reset with isolated post-reset session keys
  - request/response boundary logging for Hermes calls
- The inbound routing layer now supports:
  - slash-command parsing
  - route classification from policy outcome into blocked, local, or Hermes flows
  - initial local safe-command replies
  - technician-command gating stubs
  - audit logging for allow and deny outcomes
- Startup no longer hard-fails on a mandatory OpenWA fetch; live OpenWA inspection is available through dedicated debug routes instead.

## Milestone Mapping
- Foundation milestone: Phase 4
- Transport milestone: Phase 5
- Authorization milestone: Phase 6
- Conversation milestone: Phase 7
- Routing milestone: Phase 8
- Automatic inbound milestone: Phase 9
- Operations milestone: Phase 10

## Source-of-Truth Note
Implementation work in this repository should follow the root `docs/` documents. External study material may inform decisions, but it is not part of the working source of truth for this repo.

## Non-Goals
- No forced merge between the main Hermes profile and the WhatsApp helpdesk profile.
- No direct exposure of unrestricted Hermes tools to WhatsApp users.
- No WhatsApp implementation changes in this document-only phase.
