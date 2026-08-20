# Deployment and Environment

## Purpose
Define the initial deployment shape, required environment variables, and runtime expectations for the WhatsApp helpdesk bridge.

## Initial Deployment Shape
- Runtime: Node.js 22
- App process: single TypeScript service started from `dist/index.js`
- Default bind: `127.0.0.1:8787`
- Recommended production exposure:
  - run the service behind a reverse proxy or internal ingress
  - expose only the webhook and health routes that must be reachable
  - keep `.env` local to the service host and outside the public web root

## Suggested Production Topology
```text
OpenWA server
-> webhook POST to wa-plugin-helpdesk
-> local policy + broker
-> Hermes marisa API
-> reply back to OpenWA HTTP API
```

Recommended host responsibilities:
- OpenWA remains the WhatsApp transport boundary
- this service remains the policy, routing, and Hermes bridge boundary
- Hermes `marisa` remains the conversational helpdesk boundary

## Required Environment Variables

### Core App
- `APP_NAME`
  - optional
  - default: `wa-plugin-helpdesk`
- `APP_HOST`
  - optional
  - default: `127.0.0.1`
- `APP_PORT`
  - optional
  - default: `8787`
- `NODE_ENV`
  - optional
  - recommended production value: `production`
- `LOG_LEVEL`
  - optional
  - supported values: `debug`, `info`, `warn`, `error`
  - default: `info`
- `LOG_FORMAT`
  - optional
  - supported values: `pretty`, `json`
  - default: `pretty` in development and `json` in production

### Hermes
- `HERMES_BASE_URL`
  - required
  - expected current target: dedicated `marisa` API server
- `API_SERVER_KEY`
  - required
- `HERMES_MODEL`
  - optional
  - default: `marisa`
  - set this explicitly if the dedicated Hermes profile uses a different model name
- `HERMES_MODE`
  - optional
  - supported values: `sync`, `async`
  - the WhatsApp bridge now honors this setting directly:
    - `sync` uses `/v1/chat/completions`
    - `async` uses `/v1/runs` and polls until the run reaches a terminal status
  - keep `sync` as the simpler operational default unless the deployment explicitly wants async behavior
- `HERMES_TIMEOUT_MS`
  - optional
  - default: `20000`
- `HERMES_MAX_ATTEMPTS`
  - optional
  - default: `2`
- `HERMES_RETRY_DELAY_MS`
  - optional
  - default: `500`

### OpenWA
- `OPENWA_BASE_URL`
  - required
- `OPENWA_SESSION_ID`
  - required
- `OPENWA_API_KEY`
  - required
- `OPENWA_API_DOC`
  - optional
- `OPENWA_NUMBER_TEST`
  - optional
- `OPENWA_BOT_MENTION_ALIASES`
  - optional
  - comma-separated list of bot mention aliases observed in group messages, including LID-style values when OpenWA does not emit `mentionedJid`
  - example: `214869110423796`
- `OPENWA_TIMEOUT_MS`
  - optional
  - default: `15000`
- `OPENWA_MAX_ATTEMPTS`
  - optional
  - default: `2`
- `OPENWA_RETRY_DELAY_MS`
  - optional
  - default: `500`

### LDAP / AD
- `LDAP_ENABLED`
  - optional
  - defaults to `true` when LDAP connection fields are present
- `LDAP_URL`
  - required for AD-backed identity resolution
- `LDAP_USERNAME` or `BIND_DN`
  - one is required for bind
- `LDAP_PASSWORD` or `BIND_PW`
  - one is required for bind
- `LDAP_BASE_DN` or `BASE_OU`
  - one is required for search base

### Policy
- `TECHNICIAN_CONTACTS_PATH`
  - optional
  - recommended: set an explicit deployment-managed path such as `data/technicianContacts.json`

## Webhook Registration Targets
The application accepts these equivalent live webhook paths:
- `POST /webhooks/openwa`
- `POST /channel/webhooks/openwa`

For local verification without waiting for a real inbound push:
- `POST /channel/webhooks/test`

## Logging and Retry Defaults
- logging goes to stdout/stderr
- `LOG_FORMAT=pretty` makes terminal output easier to read during manual testing
- `LOG_FORMAT=json` keeps one-line structured JSON for log collection
- Hermes and OpenWA both use bounded retries with timeout
- retry is intended only for transient failures:
  - network failure
  - timeout
  - HTTP `429`
  - HTTP `5xx`
- retry is not intended for policy, auth, or malformed-request failures

## Session-State Evolution Path
Current state:
- Hermes continuity is stored in-process in memory
- webhook deduplication is stored in-process in memory

Implications:
- restarting the process clears session continuity and dedup memory
- this is acceptable for the initial controlled rollout, but not the long-term target

Recommended evolution:
1. keep in-memory mode for local validation and first limited rollout
2. move Hermes session mapping and webhook dedup keys into SQLite for single-node durability
3. move to Redis only if multi-process or multi-host scaling becomes necessary

Decision rule:
- if restart continuity becomes operationally important, promote session state to SQLite first
- do not jump to Redis unless multi-instance concurrency is actually required

## Deployment Notes
- do not bind this service publicly without filtering who can reach the webhook endpoint
- keep the dedicated `marisa` profile isolated from the default Hermes profile
- do not enable restricted technician or high-sensitivity commands without policy and audit updates
