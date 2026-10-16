---
name: repo-session
description: Use when changing Web credential cookies, session authority, SessionData reads/writes, prepared retries, participant lifetime, administrator recovery or force reset.
---

# Web session authority

Follow [Web instructions](../../AGENTS.md). Read only the matching contracts:

| Changed boundary | Read next |
| --- | --- |
| Admission, stale screens or confirmed invalid credentials | [Recovery decisions](../../docs/recovery.md#decision-criteria) |
| Cookies, seals, retained SQLite authority or reception changes | [Lifetime and cookie issuance](../../docs/session.md#expiration-and-cookie-issuance) and [authority limits](../../docs/session.md#local-authority-resource-limits) |
| Fixed retries, generation replacement or reset | [Retries and generation recovery](../../docs/session.md#retries-and-generation-recovery) |
| Administrator grant and fresh authentication | [Recovery destinations](../../../../docs/study-operations.md#administrator-selected-recovery-destinations) and [Support authorization](../../../support/docs/persistence.md#administrator-recovery) |
| AppContext intents or browser orchestration | [Flow skill](../repo-app-context/SKILL.md) |

## Implementation guidance

- Treat persisted state as external input. Read session-derived values through owning `read...FromSession(session)` parsers; functions needing only derived values should take those values.
- Select participant operations with `getSessionForTab(token)` or the enclosing operation context. Require the matching opaque cookie credential, current hash and live authority; a generation ID is never authentication proof. Unselected rendering may read only one verified live generation.
- Check reads and saves against the selected generation, including initial handle creation. Read-only contexts must not save/destroy a session. Use the [shared cookie mutation boundary](../../../../docs/nextjs.md#server-functions-and-cookies).
- Keep email, ciphertext and retry bodies sealed in browser storage, never SQLite or operation IDs. Apply the canonical hash/revision, pending-first-cookie and reset ordering rules in the session contracts; do not turn transient failure or stale state into destructive recovery.
- Keep session-write failures observable with safe scalar log context. New fields require synchronized `SessionData`, owning readers/writers, tests and relevant retention documentation.
- Preserve the responsibility comment in `src/lib/session.ts`; update it when its ownership boundary changes.
