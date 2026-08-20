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
- Active delivery phase: None - Phase 10 Closed
- Docker packaging is available for the Node bridge service through `Dockerfile` and `docker-compose.yml`
- `reference/` is local study material and is intentionally excluded from version control

## Local Development

1. Install dependencies with `npm install`
2. Add the required environment values in `.env`
3. Run `npm run typecheck`
4. Run `npm run build`
5. Optional for easier terminal debugging: set `LOG_FORMAT=pretty`

## Docker Run

1. Ensure `.env` on the host already contains the required OpenWA, Hermes, LDAP, and policy values.
2. Ensure `reference/whatsapp_openwa/technicianContacts.json` exists locally if technician lookup is needed in the container.
3. Build and run the bridge:
   - `docker compose up --build -d`
4. Check health:
   - `docker compose logs -f wa-plugin-helpdesk`
   - `curl http://127.0.0.1:8787/health`

Notes:
- the Docker setup packages only this Node bridge service
- OpenWA, Hermes, and LDAP remain external dependencies and are reached through the values in `.env`
- the container forces `APP_HOST=0.0.0.0` so port `8787` is reachable from the host

## Project Layout

- `src/` application source
- `docs/` source-of-truth documentation
- `chat_hermes.py` local Hermes validation helper
- `openwa_helpdesk_test.py` local OpenWA integration helper

## Technician Contacts Reference

- The default technician contacts source is `reference/whatsapp_openwa/technicianContacts.json`
- Runtime resolves this through `TECHNICIAN_CONTACTS_PATH` and falls back to that reference path when the env var is not set
- If there is another `technicianContacts.json` outside `reference/`, treat it as non-canonical unless `TECHNICIAN_CONTACTS_PATH` explicitly points to it
