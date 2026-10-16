# Contributing Guidelines

This document is for people editing, reviewing, or releasing this repository. If you only want to run or evaluate the app, start with [`README.md`](README.md). Use [`docs/architecture.md`](docs/architecture.md) to trace ownership, state transitions, and data flow.

Run pnpm commands from the workspace root, preferring the maintained [workspace entrypoints](../../docs/development.md#workspace-commands); use `pnpm --filter @aerpp/web run <script>` for other Web scripts. Source paths are relative to `apps/web`. Workspace verification and releases follow the [root contributor guide](../../CONTRIBUTING.md).

Shared implementation references are [Next.js development](../../docs/nextjs.md), [code organization](../../docs/code-organization.md) and [coding conventions](../../docs/coding-conventions.md). Agent task routing remains in [Web AGENTS.md](AGENTS.md).

## Branching Strategy

Follow [workspace contribution rules](../../CONTRIBUTING.md) and [source release/publish guidance](../../docs/releases.md). Application production acceptance follows the [deployment gate](../../docs/deployment.md#release-acceptance); app-local scripts do not establish monorepo distribution readiness.

## Local Development

Use the [workspace setup](../../docs/development.md) and [shared profiles](../../docs/configuration.md); root `.env` contains development-tool settings only. The Dev Container installs Japanese fonts, locked dependencies and shared Playwright Chromium. Its Docker settings do not establish the permissions of a tool's separate command sandbox.

[package.json](package.json) lists app-local helpers. `verify` covers lint/boundaries, types, unit tests; root verification adds workspace checks and Support with the standalone Firestore emulator. Use `node apps/web/scripts/report-react-compiler.mjs` for optional compiler diagnostics and `pnpm --workspace-root run license` for the dependency inventory. Format only files in scope. Use the root image/bundle and release procedures.

Use [browser, screenshot and PDF checks](docs/testing.md) for synthetic validation, and [development diagnostics](docs/development-tools.md) for environment validation or sandbox failures.

## Coding Conventions

### Baseline Style

Follow Biome and the [workspace coding conventions](../../docs/coding-conventions.md#style-and-naming). Write comments in English. Follow [explicit boolean decisions](../../docs/coding-conventions.md#boolean-decisions), requiring actual `true` for success, permission or progression. External copies remain read-only under the workspace rules.

`format` applies formatting, while `lint:fix` also applies safe lint/import fixes.

### React Compiler and Memoization

- Keep `reactCompiler: true` enabled. Prefer ordinary functions and derived values in new rendering code when the compiler can optimize them.
- Do not remove existing `useMemo` or `useCallback` mechanically: some functions are skipped, and stable callbacks are consumed by Effects. Check compilation and relevant interactions before changing them.
- Keep cleanup and concurrency behavior intact when investigating compiler bailouts. Use `node apps/web/scripts/report-react-compiler.mjs` to inspect eligibility before changing memoization. It uses Next.js's private bundled Babel API and does not reproduce the client bundle or measure renders/performance; recheck the adapter after framework upgrades. Do not remove cleanup or cancellation merely to increase compiled counts.
- Keep `typedRoutes: true` enabled and use `pnpm run typecheck:web` so internal link checking uses regenerated route definitions.

### Error Handling and Validation

Follow [shared Next.js validation and failure handling](../../docs/nextjs.md#validation-and-failure-handling) and its runtime-setting rules. Participant API parsing and request IDs follow [Web architecture](docs/architecture.md).

### Type and Schema Organization

Follow [shared definition-file guidance](../../docs/code-organization.md#definition-files) for naming and schema/type ownership.

### Route-Specific Conventions

Keep app identity and the root description in `src/app/manifest.json`; the root layout reuses its name, description and light theme color. Set a stable `id`, `start_url` and `scope` of `/`, with `lang: "ja"`. The manifest's white launch background matches the light page background; root viewport metadata supplies light/dark browser theme colors without changing the manifest's launch background.

Manifest PNG icons belong in `public/`, referenced by root-relative URLs. Keep `favicon.ico`, `icon.svg` and `apple-icon.png` in `src/app/` for automatic Next.js metadata. Use the existing blue UI palette for readable text and controls; decorative icon gradients need not use identical colors. Use `background-color` for the body base so it does not erase the layout's background image.

Apply the [shared development-only route rules](../../docs/nextjs.md#environment-and-development-only-behavior) to `src/app/debug/**`. Keep the shared layout and page-entry guards, and reject disabled debug/reset routes in `src/proxy.ts` before streaming or session reads. All guards use `env.debugPagesEnabled`.

- `/debug` shows a sanitized live snapshot for the current request, including the current stage/step, server-confirmed questionnaire kind, accepted-survey and recovered-survey flags, consent event timestamps/types, configured external endpoints without query strings, and current client-side `AppContext` and browser-result presence (never the sealed payload). It must not display participant identifiers or email values, even in masked form.
- `/debug` includes a refresh button that re-runs the server-side reads on demand.
- `/debug/home-flow` shows client-side `AppContext` values such as `rootStep`, analysis/restoration state, withdrawal cleanup/restart status, session admission, stored result presence and survey answer keys. Show only presence for the stored result; never display its raw or sealed contents.
- `/debug/alert-message` is a component preview page for visual inspection during development.
- The footer uses the same `env.debugPagesEnabled` value as the debug layout. See [Debug Routes](docs/usage.md#debug-routes) for default availability and operator settings.

### Code Placement

Use the [architecture ownership map](docs/architecture.md#ownership-boundaries) to choose the owning area. Keep UI, hooks, actions, services, schemas, helpers, and tests together in the feature they serve. Promote code to shared infrastructure or presentation-only UI only when its responsibility warrants that placement.

Update the architecture document when ownership boundaries or the StepState workflow change. Detailed placement guidance lives in the [shared code-organization guide](../../docs/code-organization.md).

### Logging Rules

Use the Web structured logger and follow [Web logging](docs/logging.md) for boundary ownership, event names, redaction, request IDs and dependency retries. Keep the log envelope vendor-neutral (`timestamp`, `message`, `level`, `severity`, `service`, `env`, `version`) and success logs sparse. Workspace privacy constraints apply to all logs.

### Self-Review Priority

Follow the [workspace review order](../../docs/coding-conventions.md#review-order).

## Development Principles

Follow [workspace principles](../../CONTRIBUTING.md#development-principles), including on-premises processing, explicit user control, bounded review and reproducible verification. The [architecture](docs/architecture.md) owns detailed state, persistence and recovery contracts. Use current diffs and task/PR evidence when selecting the next review scope; reopen earlier work for changed code, new evidence or an unresolved gap.

For cross-tab, delayed-response, navigation and recovery changes, verify combined behavior with synthetic inputs and local stubs. Record exact revision/patch, prerequisites and external limits without transferring participant data or secret files as fixtures.

## Maintaining Documentation

Use the [documentation index](README.md#documentation) to select the owning document. Keep shared procedures in the [workspace guides](../../docs/README.md) and Web contracts and diagnostics in `docs/`. Skills select the relevant guides for agents. Prefer a short summary and a link when another document owns the full explanation.

- Update setup instructions with the root shared JSON template, architecture with state or ownership changes, and notices with the dependency or asset inventory they describe.
- Follow the [manual changelog policy](../../docs/releases.md#manual-changelog) for changes since a release. Retain published sections as historical behavior; a version bump alone does not establish publication.
- When moving a file or heading, update incoming links and verify heading anchors. Use the root documentation check described in [documentation maintenance](../../docs/development.md#documentation-maintenance), plus the skill checker for agent instructions.
- Keep full third-party license texts unchanged when editing surrounding guidance.

## Before Opening a PR

Follow the [workspace verification requirements](../../CONTRIBUTING.md#before-opening-a-pr); root verification includes the guidance checker and isolated Support with the standalone Firestore emulator. The Web `verify` command is the app-only check. Browser-facing flow and E2E changes also require Web browser tests; [Web testing](docs/testing.md) owns browser, screenshot and PDF procedures.

- Rebase onto the latest `main` branch, or merge `main` into your branch.
- Describe the problem, resulting behavior, side effects and verification. Include screenshots for user-visible changes when relevant.

### Manual Merge Evidence

Application builds and tests run locally; the repository has no application CI workflow. Dependabot update jobs do not replace the [workspace verification gates](../../CONTRIBUTING.md#before-opening-a-pr). Record the following in each pull request before merge:

- The commit that was tested.
- The local verification commands that passed.
- Whether a production build was required and run.
- Any environment or external-service behavior that was not exercised, including missing prerequisites and unverified required checks.

Never paste environment values, logs containing sensitive data, research documents, or participant data into an issue or pull request.
