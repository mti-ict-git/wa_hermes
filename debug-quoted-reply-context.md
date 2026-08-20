# Debug Session: quoted-reply-context
- **Status**: [OPEN]
- **Issue**: WhatsApp quoted replies such as `yang ini` do not carry the replied-message context into the helpdesk broker response.
- **Debug Server**: pending start
- **Log File**: `.dbg/trae-debug-log-quoted-reply-context.ndjson`

## Reproduction Steps
1. Send a normal private WhatsApp message and receive a bot reply.
2. Reply to a previous message bubble using WhatsApp quote/reply UI.
3. Send a short ambiguous follow-up such as `yang ini`.
4. Observe whether the bot references the quoted message correctly.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | OpenWA webhook payload contains quoted metadata, but the current normalizer drops it. | High | Low | Pending |
| B | The quoted metadata exists under different field names than the current parser expects. | High | Low | Pending |
| C | Normalized inbound event lacks quoted fields, so broker input can never include parent-message context. | High | Low | Pending |
| D | Broker prompt currently sends only the latest message text and ignores quoted context even if available. | High | Low | Pending |
| E | Live OpenWA webhook payload for reply differs from synthetic test payload, so only live traffic reproduces the issue. | Medium | Medium | Pending |

## Log Evidence
- Pre-fix live log evidence:
  - `quotedMessage` appears as a top-level payload key on live reply webhook payloads.
  - The current parser reported `hasQuotedMessage=true` but `rawQuotedText=null` and `rawQuotedStanzaId=null`.
  - The broker input showed `message="ini apa"` and `includesQuotedSection=false`, so the parent message never reached Hermes.

## Verification Conclusion
- Hypothesis A: **Confirmed**. Live webhook payload contains quote-related data, but the current normalizer drops it.
- Hypothesis B: **Confirmed**. The live payload shape differs from the parser assumption; `quotedMessage` is present at the top level.
- Hypothesis C: **Confirmed**. `NormalizedInboundEvent` has no quoted-context fields, so downstream layers cannot receive them.
- Hypothesis D: **Confirmed**. Broker prompt only sends the latest message text and ignores quoted context.
- Hypothesis E: **Confirmed**. The bug is tied to live OpenWA webhook payload shape rather than the current synthetic assumptions.
