# wa_hermes

WhatsApp helpdesk bridge that connects OpenWA transport with a dedicated Hermes profile for ICT support workflows.

## Repository Guide

The source of truth for scope, architecture, API behavior, and delivery phases lives under `docs/`.

Start here:

- `AGENTS.md` for the repository working method
- `docs/helpdesk-whatsapp-design.md` for the target architecture and policy model
- `docs/technical-implementation-plan.md` for implementation sequencing details
- `docs/implementation-roadmap.md` for active phase and verification status
- `docs/open-questions-and-challenges.md` for unresolved items

## Current Status

- TypeScript is the primary implementation language
- Active delivery phase: Phase 7 - Hermes Broker and Session Store
- `reference/` is local study material and is intentionally excluded from version control

## Local Development

1. Install dependencies with `npm install`
2. Add the required environment values in `.env`
3. Run `npm run typecheck`
4. Run `npm run build`

## Project Layout

- `src/` application source
- `docs/` source-of-truth documentation
- `chat_hermes.py` local Hermes validation helper
- `openwa_helpdesk_test.py` local OpenWA integration helper
