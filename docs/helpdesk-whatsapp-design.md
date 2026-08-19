# WhatsApp Helpdesk Design

## Purpose
Define the target design for a dedicated WhatsApp helpdesk channel built on the `whatsapp_openwa` architecture and backed by a separate Hermes profile (`marisa`) for conversational helpdesk behavior.

This document is the source of truth for:
- inbound identity and authorization rules
- role separation between regular users and technicians
- local command safety boundaries
- `OpenWA -> Hermes` integration boundaries
- the module shape expected in the root implementation

## Status
- Design only
- No implementation is performed by this document
- Hermes profile isolation was validated separately against the `marisa` API server on `http://10.60.10.59:8643`

## Source Documents
- `AGENTS.md`
- `docs/helpdesk-whatsapp-design.md`
- `docs/implementation-roadmap.md`
- `docs/technical-implementation-plan.md`

## Design Basis
This document was informed by prior study of the Hermes and OpenWA-based reference systems, but the working source of truth for this repository is now the root `docs/` set only.

## Implementation Language
- The target implementation language for this project is TypeScript.
- Temporary local test harnesses may exist in Python for rapid validation, but production-facing application code should be implemented in TypeScript.

## Goals
- Reuse the transport and workflow shape from `whatsapp_openwa`.
- Keep WhatsApp production traffic isolated from the main Hermes profile.
- Allow only company users whose mobile exists in Active Directory and whose AD record has a `mail` field.
- Support two role families:
  - regular registered user
  - registered technician from technician contacts
- Keep policy enforcement local to the OpenWA application.
- Use Hermes `marisa` only for helpdesk conversation and reasoning after local policy passes.
- Deny restricted operations by default.

## Non-Goals
- No profile multiplexing with the default Hermes profile.
- No direct exposure of unrestricted Hermes capabilities to WhatsApp users.
- No requirement that group chat behave exactly like private helpdesk chat.
- No removal of the existing dispatcher / notification foundations from `whatsapp_openwa`.

## Runtime Boundary

### Hermes Profile
- Dedicated profile: `marisa`
- Dedicated API server base URL: `http://10.60.10.59:8643`
- This profile must remain operationally separate from the default profile.

### Why Separate Profile Is Mandatory
- Separate `.env`, `config.yaml`, `SOUL.md`, memory, sessions, skills, and gateway state.
- Prevents helpdesk WhatsApp instructions, memories, and session history from mixing with the main profile.
- Allows helpdesk-specific tool restrictions and personality without affecting the main profile.

## Top-Level Architecture

```text
OpenWA webhook
-> Event normalizer
-> Identity resolver
-> Access policy engine
-> Route classifier
   -> local command handlers
   -> helpdesk conversation broker
   -> reaction / dispatcher workflow
-> Messaging service
```

## Transitional Test Strategy
- Before the full webhook-driven implementation is built, the repository may use a minimal local CLI harness for rapid testing.
- This harness is allowed to:
  - read recent OpenWA messages
  - pick a private chat manually
  - relay a message to Hermes `marisa`
  - optionally send the reply back through OpenWA
- This harness is not the target production architecture; it is only a fast validation tool for the integration boundary.

## Layer Responsibilities

### 1. OpenWA Adapter Layer
Owns:
- webhook reception
- payload capture
- event normalization
- outbound message delivery
- contact and group lookup

Must not own:
- AD authorization rules
- technician role policy
- helpdesk reasoning

### 2. Identity and Policy Layer
Owns:
- sender phone normalization
- AD eligibility lookup
- technician lookup from technician contacts
- chat-context restrictions
- command authorization

This is the hard gate. Hermes is never called before this layer returns `allow`.

### 3. Local Workflow Layer
Owns:
- slash command parsing
- helpdesk claim/reaction routing
- dispatcher integration
- self-service and technician command execution

### 4. Hermes Broker Layer
Owns:
- conversational helpdesk reasoning
- ticket triage guidance
- question answering for valid helpdesk flows
- formatting the final conversational response

Must not own:
- primary authorization
- raw command privilege decisions
- unrestricted ops execution

## Identity Model

### Canonical Identity
The system must normalize every sender to a stable canonical phone number before authorization.

Inputs may include:
- `senderId`
- `senderPhone`
- `@c.us`
- `@lid`

The canonical identity is:
- normalized phone digits for policy evaluation
- original WhatsApp identifiers retained only for routing and reply transport

### Active Directory Eligibility
A sender is considered an eligible company user only when all conditions are true:
- the normalized phone number resolves to an AD user
- the AD user record contains a non-empty `mail`

If either condition fails, the sender is rejected from helpdesk interaction.

### Technician Identity
Technician status is determined from technician contacts.

Rules:
- technician lookup happens after AD eligibility succeeds
- technician contacts are the source of truth for technician-only command access
- technicians are still treated as company users first; technician is an additional role

## Role Model

### `unregistered`
- no AD match by mobile number
- or AD record exists but `mail` is empty

Behavior:
- denied

### `user`
- AD-eligible sender
- not present in technician contacts

Behavior:
- private helpdesk chat allowed
- restricted commands denied unless explicitly marked safe

### `technician`
- AD-eligible sender
- present in technician contacts

Behavior:
- private helpdesk chat allowed
- technician-only command subset allowed
- still subject to deny-by-default command policy

## Chat Context Rules

### Private Chat
- primary supported context for helpdesk chat
- required for regular-user conversational helpdesk
- required for restricted commands

### Group Chat
- regular user conversational helpdesk is denied
- restricted commands are denied unless a specific group workflow is explicitly defined
- existing reaction-based helpdesk claim workflows may continue only for designated helpdesk groups

This means the design intentionally separates:
- private helpdesk interaction
- group-based technician coordination and reaction claim flow

## Route Classification
Each inbound event must be classified into exactly one of these paths:

1. `blocked`
2. `local_general_command`
3. `local_user_self_service`
4. `local_technician_command`
5. `hermes_helpdesk_chat`
6. `reaction_claim_flow`
7. `dispatcher_or_system_flow`

Classification order matters:
1. normalize sender and chat context
2. resolve AD eligibility
3. resolve technician role
4. classify event type
5. classify slash command versus free text
6. evaluate policy
7. route to the selected handler

## Command Safety Model

### Command Policy Principles
- deny by default
- every command must declare allowed roles and allowed chat contexts
- handlers do not self-authorize; policy is evaluated before execution
- command families with sensitive outputs must be auditable

## Command Categories

### Category A: General Safe Commands
Examples:
- `/hi`
- `/ping`
- `/help`

Allowed:
- `user` in private chat
- `technician` in private chat

### Category B: User Self-Service
Examples:
- ticket status lookup for own identity
- helpdesk intake shortcuts
- future self-service commands that do not expose privileged directory or device data

Allowed:
- `user` in private chat
- `technician` in private chat

### Category C: Technician Support Commands
Examples from reference behavior:
- `/finduser`
- `/resetpassword`
- `/unlock`
- `/getasset`
- `/licenses`
- `/getlicense`
- `/expiring`
- `/licensereport`

Allowed:
- `technician` in private chat only

Denied:
- all group chats
- all regular users

### Category D: High-Sensitivity Security Commands
Examples:
- `/getlaps`
- `/getlapsdiag`
- `/setlaps`
- `/getbitlocker`
- `/technician add`
- `/technician update`
- `/technician delete`

Initial design stance:
- deny by default
- do not enable automatically just because the sender is a technician
- require an explicit later decision per command family

### Category E: Helpdesk Group Reaction Commands
Examples:
- ticket claim/unclaim via reactions

Allowed:
- only in configured helpdesk groups
- only for recognized technicians
- only for tracked notification messages

## Initial Command Matrix

| Command family | User private | User group | Technician private | Technician group |
|---|---|---|---|---|
| General safe | Allow | Deny | Allow | Deny |
| Helpdesk self-service | Allow | Deny | Allow | Deny |
| Technician support commands | Deny | Deny | Allow | Deny |
| High-sensitivity security commands | Deny | Deny | Deny by default | Deny |
| Reaction claim flow | N/A | Deny | N/A | Allow only in helpdesk groups |

## Hermes Integration Design

### Broker Contract
Hermes is called only for `hermes_helpdesk_chat`.

Local layer must pass:
- stable WhatsApp chat identity
- sender phone
- sender display name if available
- resolved role
- normalized helpdesk context
- optional ticket context if already known locally

Hermes must not receive:
- unrestricted raw admin intent outside policy
- commands that local policy already rejected

### Session Strategy
Per private WhatsApp chat, store:
- `session_key`: stable per chat, for example `wa:private:<chatId>`
- `session_id`: active Hermes transcript id returned by `marisa`

Rules:
- same private chat keeps the same `session_key`
- `session_id` persists across turns until the conversation is explicitly reset or expired
- local channel storage owns this mapping, not Hermes

### Hermes Request Mode
- current stable default for profile `marisa` is synchronous `chat/completions`
- async `/v1/runs` remains a future option, but it should not be treated as the default until the runtime/model compatibility issue is resolved
- if async is reintroduced later, the docs and roadmap must be updated with fresh verification evidence

### Hermes Responsibility
Hermes `marisa` may:
- guide helpdesk intake
- ask follow-up questions
- summarize incident context
- help classify or phrase ticket content
- call only the tools enabled for the helpdesk profile

Hermes `marisa` may not:
- bypass local authorization
- act as the sole source of technician role validation
- assume every WhatsApp user is trusted

## Business Flow Design

### Flow 1: Regular User Private Helpdesk Chat
1. inbound private message arrives
2. phone is normalized
3. AD lookup validates mobile and `mail`
4. sender is classified as `user`
5. message is not a technician-only command
6. request is sent to Hermes `marisa`
7. response is returned through `MessagingService`

### Flow 2: Technician Private Command
1. inbound private message arrives
2. sender passes AD eligibility
3. sender is found in technician contacts
4. slash command is parsed
5. policy engine checks command family
6. local handler executes if allowed
7. reply is sent locally without routing through Hermes unless the command explicitly uses Hermes-backed helpdesk reasoning

### Flow 3: Group Reaction Claim Workflow
1. reaction event arrives
2. event is normalized
3. chat is verified against allowed helpdesk groups
4. sender is verified as technician
5. tracked notification record is loaded
6. claim or unclaim logic executes
7. outbound updates are sent to requester / technician / ServiceDesk as already defined by the workflow

### Flow 4: Blocked Sender
1. inbound message arrives
2. sender fails AD eligibility
3. no command or Hermes routing happens
4. a short denial message may be sent, or the message may be silently ignored depending on policy mode

## Module Design for Root Implementation

### New or Refined Modules

#### `src/features/policy/identityResolver.ts`
Responsibilities:
- normalize sender identity
- query AD-backed identity
- produce `IdentityContext`

Suggested output:
- `phone`
- `adUser`
- `isRegisteredUser`
- `isTechnician`
- `technicianContact`
- `chatType`

#### `src/features/policy/accessPolicy.ts`
Responsibilities:
- evaluate role and chat context
- evaluate command grants
- return structured allow/deny reason

Suggested output:
- `decision`
- `route`
- `reason`
- `role`

#### `src/features/inbound/routeClassifier.ts`
Responsibilities:
- distinguish command, free text, reaction, and system events
- attach route classification before execution

#### `src/features/hermes/helpdeskBroker.ts`
Responsibilities:
- build payloads for `marisa`
- manage `session_key` and `session_id`
- prefer the stable sync request mode until async compatibility is re-verified
- translate Hermes output into WhatsApp-ready replies

#### `src/features/state/hermesSessionStore.ts`
Responsibilities:
- persist WhatsApp chat to Hermes session mappings
- support reset and expiration

## Data Sources

### Source of Truth
- AD by mobile number and `mail` field: user eligibility
- technician contacts: technician status and technician metadata
- ServiceDesk Plus: ticket state and helpdesk business records
- OpenWA: transport identity and message delivery
- Hermes `marisa`: conversational helpdesk reasoning

### Source Priority
1. transport identity from OpenWA
2. canonical phone normalization
3. AD eligibility
4. technician contacts
5. route policy
6. downstream workflow execution

## Security Controls

### Hard Controls
- dedicated Hermes profile `marisa`
- local deny-by-default policy
- private-chat requirement for restricted commands
- no unrestricted forwarding to Hermes
- no trust based on WhatsApp display name alone

### Audit Controls
Every allow or deny decision for sensitive commands should log:
- masked sender phone
- resolved role
- chat type
- command name
- decision
- reason

Never log:
- passwords
- LAPS secrets
- raw recovery keys
- full mobile numbers when avoidable

## Operator Messages

Suggested deny messages:
- not registered: `Nomor Anda belum terdaftar di directory perusahaan. Hubungi ICT Helpdesk.`
- wrong context: `Layanan helpdesk WhatsApp hanya tersedia melalui private chat.`
- restricted command: `Command ini tidak tersedia untuk role Anda.`

These should remain concise and non-argumentative.

## Implementation Phases

### Phase A: Policy Foundation
- implement identity resolver
- implement access policy engine
- implement classification results and deny reasons

### Phase B: Hermes Helpdesk Bridge
- implement `marisa` broker
- add session mapping store
- route private free-text helpdesk chat to Hermes

### Phase C: Command Hardening
- refactor commands to rely on policy engine
- split safe, technician-only, and high-sensitivity commands
- keep high-sensitivity commands disabled until explicitly approved

### Phase D: Group Workflow Preservation
- preserve reaction claim flow for helpdesk groups
- ensure technician-only group actions remain constrained

## Open Questions
- Which of the high-sensitivity commands should ever be enabled for technicians on WhatsApp?
- Should blocked non-AD senders receive a denial response or be silently ignored?
- Should technicians be allowed some read-only group commands later, or should all group slash commands stay denied permanently?
- What is the desired expiration policy for `session_id` reuse on long-idle private chats?
