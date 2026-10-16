# Workspace Agent Instructions

This file owns workspace-wide rules. Read the applicable child instructions before editing an area; they add only local requirements. Paths such as `src/**` in app guidance are relative to that app. Run pnpm commands from the root, preferring the maintained `pnpm run <operation>:<target>` entrypoints in [development](docs/development.md#workspace-commands). Use `pnpm --filter @aerpp/<owner> run <script>` for other app/package scripts.

| Area | Read when working there |
| --- | --- |
| Web | [apps/web/AGENTS.md](apps/web/AGENTS.md); apply shared Next.js skills below and matching Web skills |
| Admin | [apps/admin/AGENTS.md](apps/admin/AGENTS.md); apply shared Next.js skills below and matching Admin skills |
| Support API | [apps/support/AGENTS.md](apps/support/AGENTS.md); preserve participant persistence and environment isolation |
| Shared configuration (`packages/config`) | [package instructions](packages/config/AGENTS.md) and [configuration](docs/configuration.md) |
| Shared participant API contracts (`packages/contracts`) | [package instructions](packages/contracts/AGENTS.md); preserve canonical schema and generated-copy boundaries |
| Shared participant PDFs (`packages/documents`) | [package guide](packages/documents/README.md) and [document sets](docs/document-sets.md); callers own authorization, record selection and original verification |
| Shared Firestore persistence (`packages/firestore`) | [package instructions](packages/firestore/AGENTS.md); preserve application transaction and authorization boundaries |
| Workspace scripts and infrastructure | [development](docs/development.md), [configuration](docs/configuration.md), [deployment](docs/deployment.md), as relevant |

Root orchestration belongs in the owning purpose directory under [scripts/](scripts/README.md); app-specific helpers belong in that app. Keep one root pnpm lockfile. Preserve unrelated uncommitted changes. Routine fixes do not authorize releases, pushes, cloud writes, mail or deployments; follow the user's existing authorization and target scope.

Before work involving private configurations or operator records, read root `.agents/AGENTS.md` when present. This ignored file supplements the public rules; its absence must not block public setup or verification. Keep private installation details and local handoff instructions there rather than in tracked AGENTS files. Preserve `.codex/` for its tool-defined configuration/state; do not repurpose it for documentation or shared instructions. See [local agent guidance](docs/development.md#local-agent-guidance).

Follow the [repository structure and visibility guide](docs/structure.md) for directory roles, private and generated ownership and Git, package and Docker boundaries.

## Development and verification

[CONTRIBUTING.md](CONTRIBUTING.md) owns development principles and verification requirements; [docs/development.md](docs/development.md) owns workspace commands. Keep fixes, tests and documentation aligned, and report unresolved findings and unverified external behavior. Do not add GitHub Actions workflows.

- Analyze documents only with the on-premises local LLM. Never send analysis documents/results to cloud services or persist them on the server. Authentication and survey cloud flows must exclude them.
- Do not change models, generation settings or prompts without explicit user instructions; review/evaluation authorizes measurement and proposals only.
- Preserve user control over active analysis/evaluation. Reject conflicting or stale ordinary mutations on the server and offer explicit recovery. Preserve Firestore initial-study eligibility across session recovery/reset. Follow the [recovery boundaries](docs/architecture.md#local-recovery-and-withdrawal) and the affected application's local contracts.
- Follow [source release and publish guidance](docs/releases.md) for CHANGELOG/version/tag work, and [deployment requirements](docs/deployment.md) for application delivery. Root `pnpm run verify:release` remains the application production-acceptance gate; source publishing uses `pnpm run verify:publication` plus the source-release checks. Generated artifacts are not published.

### Implementation rules

- Follow [coding conventions](docs/coding-conventions.md) for style, naming, comments, logging boundaries and review order, including [explicit boolean decisions](docs/coding-conventions.md#boolean-decisions). Preserve external/persisted schema names. Use the owning application's structured logger and redact caught errors.
- Follow [code organization](docs/code-organization.md) for Web/Admin feature placement and imports, and [test placement](docs/coding-conventions.md#tests) for colocated tests, runners and production exclusions.
- For Web and Admin implementation, apply `repo-nextjs`. Apply `repo-code-organization` when choosing ownership or changing placement/imports.

### Private cloud configuration

- Never log raw or encrypted email, document bodies, LLM prompts/output, survey free text, cookies, session objects, auth headers, API keys or secret environment values.
- Keep actual GCP project IDs/numbers, deployed URLs, OAuth client IDs, service account identities and credentials out of public files, examples, commit/PR messages and screenshots.
- Select cloud targets explicitly from each private configuration's `projectId` and `infrastructure.operatorAccount`. Keep test development independent of running production. `@aerpp/config` derives application settings; never hand-edit generated configuration or introduce duplicate aliases for shared settings. Apply `repo-config-env` for configuration, startup or infrastructure changes.
- Do not keep `.env*` files, including examples, in `apps/*` or `packages/*`. Root `.env` is only for development tools; public application templates live in `config/example/`, and environment-independent LLM/questionnaire inputs live in `config/common/`.
- Keep `config/` private except `config/example/` and `config/common/`; shared LLM/questionnaire inputs must contain no credentials or private identifiers. Each configuration's `config.json` and `secret.json` contain only operator inputs, including explicitly initialized application keys. Follow [configuration ownership](docs/configuration.md#shared-configuration-and-secret-providers) for generated Console/runtime settings and [output lifecycles](docs/structure.md#private-inputs-generated-outputs-and-retained-state) for private artifacts. Generated configuration must say not to edit it. Import downloaded OAuth inputs into canonical settings and discard redundant downloads. Remove obsolete inputs after verifying their replacement; retain no retired-environment backups. Never fetch Secret Manager values or automatically create/rotate OAuth credentials, service-account private keys or Cloud Run runtime credentials. Initialize or replace application keys only when explicitly requested, using [the setup command](docs/setup.md#5-supply-stable-application-keys-and-review-shared-assets) for unused installations; preserve keys for deployed environments. Do not place `.env` files in `config/`.
- Run `pnpm run privacy:check` before publication. Its current-file scan does not replace Git-history or staged-change review.

### Protected external files

- `src/lib/external/**` contains externally provided file copies and must be treated as read-only.
- Do not add repository-authored adapters, helpers, tests, or generated files to that directory.
- Do not modify an external copy's contents, formatting, exported names, or schema definitions unless the user explicitly asks for that file to change.
- Keep repository-authored adapters in the owning feature or elsewhere under `src/lib/**`, and adapt them around the external copies.

## Public examples and templates

Maintain synthetic public examples as copy-and-edit templates for independent installations and local verification. Follow [the template guide](docs/examples.md) for replacement inputs, required/conditional fields, private destinations and validation. [Setup](docs/setup.md) owns the script-assisted path; [environment construction](docs/environment-construction.md) explains the required state for independent manual/AI construction. Preserve editable templates for that independent path, distinguish runnable defaults, cloud placeholders and generated outputs, and link to canonical templates instead of duplicating them.

## Maintaining agent guidance

Write maintained documentation and agent guidance in English by default. Preserve exact UI labels and externally supplied texts in their original language when needed.

Public guides describe the current supported system. Follow [documentation visibility](docs/README.md#public-documentation-and-private-notes) for public references and private operator notes.

Keep always-applicable workspace rules here, app/package-only constraints in child AGENTS.md files, and substantial conditional procedures in the owning `skills/<name>/SKILL.md`. Shared skills belong in root `skills/`; app/package-specific skills stay with that owner. Do not create a skill for a few universal coding rules. Preserve the Next.js-managed blocks.

Name repository skills `repo-<purpose>` and index each once in its owning AGENTS.md with a direct relative entrypoint link and task-specific description. Read only matching skills and references. Keep shared human/agent specifications and contributor/operation procedures in their canonical guides; reserve skill-local `references/` for agent-only details. Follow [guidance ownership and path conventions](docs/development.md#agent-guidance), and run the [documentation, guidance and command-reference checks](docs/development.md#documentation-maintenance) after guidance or package-script changes.

## Shared task-specific skills

- `repo-nextjs`: [shared Web/Admin Next.js implementation guidance](skills/repo-nextjs/SKILL.md) for routes, components, Server Functions, validation, runtime settings and development-only pages.
- `repo-code-organization`: [shared Web/Admin code placement and imports](skills/repo-code-organization/SKILL.md) for feature ownership, definition files and dependency direction.
- `repo-config-env`: [shared configuration, startup isolation, debugger environments and infrastructure boundaries](skills/repo-config-env/SKILL.md).
- `repo-testing`: [selecting verification for a change and maintaining tests](skills/repo-testing/SKILL.md), with references by affected owner.
- `repo-license-notices`: [workspace license generation, display and distribution notices](skills/repo-license-notices/SKILL.md).
