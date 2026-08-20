# Operational Runbook

## Purpose
Provide day-2 operator steps for starting, validating, recovering, and troubleshooting the WhatsApp helpdesk bridge.

## Normal Startup
1. Confirm `.env` is present and contains Hermes, OpenWA, LDAP, and policy settings.
2. Build the application:
   - `npm run build`
3. Start the service:
   - `node dist/index.js`
4. Confirm health:
   - `GET /health`
5. Confirm config shape without exposing secrets:
   - `GET /debug/config`
6. Confirm OpenWA transport connectivity:
   - `GET /debug/openwa-session`

## Expected Logging Shape
The service writes structured JSON logs with:
- `ts`
- `level`
- `scope`
- `event`
- contextual fields such as route, message id, delivery mode, or retry attempt

Important scopes:
- `wa-plugin.server`
- `wa-plugin.webhooks`
- `wa-plugin.openwa`
- `wa-plugin.hermes`
- `wa-plugin.router`
- `wa-plugin.broker`
- `wa-plugin.messaging`

## Webhook Recovery
Symptoms:
- OpenWA session is ready, but no inbound messages reach the service

Recovery steps:
1. Confirm the service is running and `GET /health` returns `ok: true`.
2. Confirm the expected webhook URL is still registered in OpenWA.
3. Confirm the registered path matches one of:
   - `/webhooks/openwa`
   - `/channel/webhooks/openwa`
4. Send a controlled synthetic payload to `POST /channel/webhooks/test`.
5. If the test path works but live inbound still fails, re-register the webhook in OpenWA and retest.

## Message Replay Strategy
Current state:
- there is no durable replay queue in the TypeScript service yet
- replay is currently operator-driven

Recommended operator approach:
1. identify the affected chat and approximate message time in OpenWA
2. inspect recent messages from OpenWA
3. if needed, resend the message content through `POST /channel/webhooks/test`
4. use `sendReply: false` first to validate routing safely
5. repeat with `sendReply: true` only after the pipeline result is correct

## Duplicate Delivery Handling
Current behavior:
- duplicate `message.received` webhook payloads are skipped by `messageId`
- in-flight duplicates are also skipped
- a payload is marked processed only after successful handling

Implication:
- a failed processing attempt should still be replayable, because failed messages are not permanently marked processed

## Hermes Failure Recovery
Symptoms:
- webhook pipeline reaches the broker but returns `502` or a logged Hermes failure

Recovery steps:
1. inspect structured logs for `scope=wa-plugin.hermes`
2. check whether the failure is:
   - timeout
   - network error
   - HTTP `5xx`
   - auth/config failure
3. retry once through `POST /channel/webhooks/test`
4. if the issue persists, verify the dedicated `marisa` endpoint directly
5. if Hermes is down, pause live webhook expectations until the endpoint is healthy again

## OpenWA Failure Recovery
Symptoms:
- routing succeeds, but outbound delivery fails

Recovery steps:
1. inspect structured logs for `scope=wa-plugin.openwa` and `scope=wa-plugin.messaging`
2. confirm the OpenWA session is still `ready`
3. retry a direct `send-text` verification if needed
4. if reply-by-quoted-message fails because the target message is not found, the service should fall back to plain `send-text`
5. if even plain `send-text` fails, treat it as transport outage and recover OpenWA first

## Restricted Command Audit Review
For blocked or sensitive commands, inspect logs for:
- `category=audit`
- `event=policy_decision`

Expected fields:
- masked phone
- resolved role
- chat type
- command name
- route
- decision
- reason

## Restart Procedure
1. stop the current process
2. deploy updated files and rebuild if needed
3. start `node dist/index.js`
4. confirm:
   - `/health`
   - `/debug/config`
   - `/debug/openwa-session`
5. run a controlled webhook test through `/channel/webhooks/test`

## Escalation Notes
- if `@lid` senders start failing for valid users, treat that as an identity-resolution issue rather than a Hermes issue
- if restart continuity becomes operationally important, prioritize moving session state from memory to SQLite
