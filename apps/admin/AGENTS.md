<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Admin Agent Instructions

Inherit [workspace rules](../../AGENTS.md). Contributor commands, ownership and PR procedures live in [CONTRIBUTING.md](CONTRIBUTING.md); setup and behavior are in [README.md](README.md). Paths here are relative to `apps/admin`.

Apply the shared Next.js and code-organization skills indexed in [root AGENTS.md](../../AGENTS.md#shared-task-specific-skills) for implementation and placement changes.

## Local implementation rules

- Use `@google-cloud/firestore` through the server-only `src/lib/firestore.ts` adapter. Use `@aerpp/firestore` for shared participant/information references, queries and research snapshots. Keep explicit project selection, project-bound local gcloud impersonation and hosted ADC. OAuth remains owned by NextAuth.
- Preserve the development-only authentication bypass and normal OAuth checks. Never allow the bypass in production.
- Questionnaire content is an application input; infrastructure maintenance must not change it.
- Apply `repo-admin-data` for participant monitoring, recovery lookup/authorization, aggregation, questionnaire loading or source-export changes. Keep operational monitoring separate from offline research analysis and keep research/access downloads separate.

## Focused verification

Select checks through `repo-testing` and the [Admin development guide](CONTRIBUTING.md#development); use the [Admin review criteria](CONTRIBUTING.md#review) for authentication and data changes. Local checks do not establish real OAuth, Firestore or Cloud Logging behavior.

## Task-specific skills

Source paths in Admin skills are relative to `apps/admin`; pnpm commands run from the workspace root, preferring maintained root entrypoints and otherwise explicit package filters.

- `repo-admin-data`: [participant monitoring and recovery, survey counts, questionnaire inputs and separate research/access exports](skills/repo-admin-data/SKILL.md)
