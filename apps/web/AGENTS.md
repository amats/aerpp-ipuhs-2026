<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Web Agent Instructions

Inherit [workspace rules](../../AGENTS.md). This file owns only Web constraints; contributor procedures are in [CONTRIBUTING.md](CONTRIBUTING.md), and the ownership/state map is in [architecture](docs/architecture.md).

Apply the shared Next.js and code-organization skills indexed in [root AGENTS.md](../../AGENTS.md#shared-task-specific-skills) for implementation and placement changes.

- Use `src/lib/logger.ts` for server logging and preserve its redaction/allowlist behavior. Read `repo-logging` when changing log events or fields.
- Flow changes require `repo-app-context`; session authority, cookies, sealed retries and recovery additionally require `repo-session`. Keep server mutation guards and explicit user recovery aligned.
- Tabs share a browser session without competition checks or awake signals. Validate actions against the current composite hash. Stale screens prompt reload; confirmed invalid sessions recover to fresh authentication. Production administrator recovery requires the current credential/hash and server grant, then fresh consent/email confirmation before applying the selected destination. Debug-only `/reset` is the force-recovery exception from any tab: revoke captured sessions before origin cleanup. See [session contracts](docs/session.md#retries-and-generation-recovery).
- Keep app-flow contracts such as `RootStep`, `Stage`, and `StepState` in `src/features/app-context/**` even when other features consume them. Keep `src/proxy.ts` responsible for request ID forwarding and independent of participant session mutation.
- Parse participant API requests/responses through `@aerpp/participant-api-contracts/participant-api`, using helpers such as `safeParseApiSuccess(...)`. Preserve `x-request-id` on route validation/failure responses when a request logger is available.
- For debug-page changes, follow shared Next.js guards and the [Web debug behavior](CONTRIBUTING.md#route-specific-conventions).

### Research assets

- Supplied research documents under `assets/**` and `assets-public/**` are read-only unless the user explicitly authorizes content changes. Keep clarifications in the owning UI and maintained guides.
- Follow [research asset selection and setup](../../docs/examples.md#research-assets): `assets-public/**` is the tracked MDX/PDF set; `assets/**` is the Git-ignored operational set. Reject incomplete private sets instead of mixing them with public files. Distribution images require private assets; browser tests and screenshots always use public assets. Keep editable DOCX/ODT working documents excluded.
- `config/common/survey/**` owns the questionnaire JSON used by Web in every environment and archived by hash for Admin research ZIPs. `config/common/llm/**` owns shared local model presets. Preserve supplied content when changing paths or build plumbing.
- When moving either asset set, update MDX alias resolution, PDF readers, Git/Docker exclusions, image inputs and setup guidance together. Keep source originals unchanged; Docker stages only the required private files and records their hashes.

## Task-Specific Skills

Use only the matching skills below and their relevant references. Shared guidance is indexed in root AGENTS.md. Source paths in Web skills are relative to `apps/web`; pnpm commands run from the workspace root, preferring maintained root entrypoints and otherwise explicit package filters.

- `repo-app-context`: [app flow state, StepState transitions, and AppContext orchestration](skills/repo-app-context/SKILL.md)
- `repo-session`: [credential cookies, session lifetime, sealed retries, administrator recovery and reset](skills/repo-session/SKILL.md)
- `repo-logging`: [structured logging details beyond the always-on defaults](skills/repo-logging/SKILL.md)
