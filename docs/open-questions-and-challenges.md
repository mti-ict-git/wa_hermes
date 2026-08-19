# Open Questions and Challenges

## Current Notes
- The repository currently lacks the fuller documentation baseline described in `AGENTS.md`. For this task, a minimal docs set was added so session-persistence work has a documented source of truth.
- The CLI helper persists one local conversation state file for the default session key. If multi-user or multi-chat local testing is needed later, the state model should be extended to support multiple named sessions.
- The Hermes profile behind this helper may still reject some requests with provider/model-specific settings such as `prompt_cache_retention`. Async runs address HTTP timeout pressure, but they do not replace fixing incompatible model options in the Hermes profile itself.
- WhatsApp helpdesk design decisions are now captured in `docs/helpdesk-whatsapp-design.md`, but these policy questions remain open:
  - which high-sensitivity commands should ever be enabled on WhatsApp
  - whether blocked non-AD senders should receive an explicit denial response or be silently ignored
  - whether any technician group slash commands should be allowed later
  - how long Hermes `session_id` reuse should survive idle private chats
- Phase 5 live OpenWA verification showed incoming private chats may arrive with `chatId` / `from` in `@lid` form instead of phone-like `@c.us`. The current TypeScript normalizer treats `@lid` as private chat, and the current Phase 6 policy foundation will deny those senders unless a canonical phone can be resolved first. A confirmed strategy is still needed to map `@lid` senders to canonical AD-backed phone identity.
