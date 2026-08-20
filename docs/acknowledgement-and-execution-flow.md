# Acknowledgement and Execution Flow

## Purpose
Define the runtime execution flow for WhatsApp helpdesk requests that need:
- fast user acknowledgement
- typed-intent generation by Marisa
- server-side validation
- trusted adapter execution
- final Marisa summarization

## Canonical Flow

1. Receive inbound WhatsApp message from OpenWA.
2. Read sender identity from OpenWA metadata, not from message text.
3. Normalize sender phone locally.
4. Exact-match the normalized phone against technician contacts.
5. Default to regular `user` when no technician match exists.
6. Build a short-lived HMAC-signed `AuthContext`.
7. Send early ACK:
   - `Baik, permintaan sedang diproses.`
8. Send the user message and trusted context summary to Marisa for typed-intent generation.
9. Validate typed intent against `AuthContext`.
10. If allowed, execute the approved read-only adapter locally.
11. Redact and bound the adapter result.
12. Send only the safe result to Marisa for natural-language summarization.
13. Send the final WhatsApp response.

## Execution Stages

### Stage 1: Ingress and Identity
Owns:
- webhook reception
- sender extraction from OpenWA metadata
- canonical phone normalization
- technician exact-match
- private or group chat classification

Outputs:
- normalized inbound event
- local role decision
- request correlation id

### Stage 2: Trusted Context and ACK
Owns:
- `AuthContext` creation
- HMAC signature
- nonce generation
- TTL assignment
- early user ACK

Outputs:
- signed `AuthContext`
- `request_id`
- ACK delivery record

### Stage 3: Typed Intent Generation
Owns:
- Marisa prompt for structured intent only
- JSON parsing of model output
- intent schema validation handoff

Must not own:
- authorization
- backend execution
- target identity trust

Outputs:
- typed intent candidate

### Stage 4: Validation and Adapter Execution
Owns:
- `AuthContext` verification
- role/intent allowlist checks
- target scope enforcement
- adapter selection
- adapter execution
- result redaction

Outputs:
- safe structured result
- stable denial or success code

### Stage 5: Final Summarization
Owns:
- Marisa natural-language rendering of safe structured result
- consistent final WhatsApp text

Must not own:
- raw backend query logic
- role upgrades
- hidden backend detail disclosure

## ACK Policy

### When ACK Is Required
- async Hermes mode
- requests likely to take more than a few seconds
- flows that need intent generation plus adapter execution

### When ACK Is Optional
- locally handled fast responses
- blocked requests that can be denied immediately

### ACK Constraints
- ACK must not imply approval
- ACK must reference the current request only
- ACK should stay short and neutral

## Failure Handling

### Typed Intent Failure
- send a controlled fallback message
- do not call adapters

### Validation Failure
- deny locally
- do not reveal internal policy logic beyond safe operator text

### Adapter Failure
- return stable operator-safe error text
- avoid leaking backend traces or credentials

### Final Summarization Failure
- fall back to a deterministic template from the safe result if possible

## Implementation Notes
- This flow is intended for the next implementation increment after the current Phase 10 closure.
- The current service already supports async Hermes calls and local policy enforcement, so the next step is to insert:
  - `AuthContext`
  - typed intent parsing
  - validator stage
  - local read-only adapters
  - early ACK plus final response correlation
