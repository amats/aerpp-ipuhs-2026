# Contributing

Use pnpm from the repository root. Follow [development and verification](docs/development.md). Read [coding conventions](docs/coding-conventions.md), [code organization](docs/code-organization.md) and [Next.js development](docs/nextjs.md) for shared implementation rules. Agent task entrypoints are indexed separately in [AGENTS.md](AGENTS.md). Application-specific conventions live in the [Web guide](apps/web/CONTRIBUTING.md) and [admin guide](apps/admin/CONTRIBUTING.md).

## Development Principles

### On-Premises Analysis and Data Handling

Process analysis documents and results only through the on-premises local LLM. Never send them to cloud services, write them to logs, or persist them on the server. Authentication and survey collection may use cloud services only through separate flows that exclude analysis documents and results.

### User Control over Analysis and Evaluation

Another tab or a stale asynchronous operation must not automatically replace active work or reset a shared session. Reject conflicting ordinary mutations on the server and provide explicit recovery choices. The debug-only, user-invoked `/reset` button may invalidate active work from any tab and must fence late writes before clearing browser state. Production administrator recovery requires a reviewed grant, participant confirmation against the current session, and renewed email authentication; preserve historical study records and fence superseded work.

### Iterative Review and Refactoring

Review in bounded passes and revisit the overall flow when the scope changes. Keep fixes, relevant tests, and documentation aligned. Record unresolved findings and verification limits. Do not change models, generation settings, or prompts without explicit instructions.

### Reproducible Verification

Distinguish synthetic tests, Emulator tests, and real-cloud behavior. Invoke cloud writes and mail tests explicitly. Do not add GitHub Actions workflows.

Select working checks using the [change-based verification matrix](docs/development.md#verification-by-change). For Support runtime, authentication, persistence or delivery changes that affect deployed behavior, verify the serving revision, cloud API and test-configured Web connectivity in the authorized test project. If that acceptance is required but outside the authorized scope, report it as not run. Documentation, formatting and developer-only command changes do not by themselves require deployment. Local mocks/emulators do not establish cloud behavior; follow the [verification sequence](docs/environments.md#verification-sequence) when cloud acceptance applies.

## Before Opening a PR

- Run `pnpm run verify` as the PR gate, after the focused working checks from the [verification matrix](docs/development.md#verification-by-change). If prerequisites prevent it, report the gate as not run or failed as applicable; focused checks alone do not establish full PR readiness. If Git metadata is unavailable, report `git diff --check` as not run.
- Also run `pnpm run build` for routes, framework configuration, production assets or build behavior, and `pnpm run test:e2e:web` for Web E2E or browser-facing participation, navigation, storage or recovery changes.
- For dependency changes, run `pnpm run build` and `pnpm audit --prod`; regenerate shipped notices for production dependency changes.
- For environment changes, validate the selected shared configuration with `pnpm run env:check example`, `test` or `production` (append the affected app for an independent check), and use the app validator for explicitly supplied process/file diagnostics.
- For versioned GitHub source releases, follow [release preparation and publishing](docs/releases.md), including `pnpm run verify:publication`, source builds/browser checks and public-file/history review. Generated artifacts, Docker images and model weights are not published.
- Run `pnpm run verify:release` for application production acceptance under [deployment](docs/deployment.md#release-acceptance). This gate is separate from source publishing. `pnpm run license:audit` remains a diagnostic for installed dependency notice coverage.
- Report commands, results, prerequisites, missing inputs, and unverified external behavior. Do not include secrets or participant data.

Keep dependencies in the root `pnpm-lock.yaml`; do not add application-local lockfiles. Do not edit externally supplied copies under `src/lib/external/**`. Follow the [shared-package deployment gates](docs/deployment.md#shared-package-and-version-gates) before introducing broader shared contracts.

## Branches and evidence

Use a work branch and pull requests; do not push directly to `main`. Confirm the integration branch before opening a PR. Use `research/*` for research variants. Follow the [single workspace version and manual changelog policy](docs/releases.md#single-workspace-version); release preparation and external publishing are separate operations.

Keep tested commit/patch, commands, outcomes, prerequisites and unverified behavior in the task or PR record. Permanent documentation owns current procedures and constraints, not accumulated execution diaries. Use the [documentation index](docs/README.md) to choose the owner and update incoming links when moving or removing a document.
