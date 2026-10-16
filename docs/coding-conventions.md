# Coding conventions

These conventions apply to maintained workspace code. Use the owning application's [contributor guide](README.md#application-and-package-guides) for local contracts and [Next.js development](nextjs.md) for Web/Admin framework boundaries. Biome configuration and the workspace checks enforce the supported subset.

## Style and naming

- In JavaScript and TypeScript, use double quotes and no semicolons.
- In JavaScript and TypeScript, use lowerCamelCase for functions, variables and repository-owned object properties.
- Use UpperPascalCase for JavaScript/TypeScript types, React components and enum-like const objects such as `Stage`.
- Use UPPER_SNAKE_CASE for JavaScript/TypeScript named fixed values, module-level policy constants and reusable CSS class tokens. A `const` binding alone does not make a value a naming constant: `const currentState = readState()` stays lowerCamelCase, while `const MAX_ATTEMPTS = 5` uses UPPER_SNAKE_CASE. Enum-like value objects such as `Stage` retain UpperPascalCase.
- Preserve framework-required exports such as `metadata`, `GET` and `POST`.
- Use strict comparisons and follow the explicit boolean decision rules below.

### Naming across languages and file formats

Use the language's customary conventions and the identifier's role, keeping the same choice within each owner. A file extension alone does not determine the case of every name: JSON and YAML keys often belong to a consumer-defined schema.

| Language or format | Naming convention |
| --- | --- |
| JavaScript / TypeScript (`.js`, `.mjs`, `.ts`, `.tsx`) | Use the symbol conventions above. Repository-owned source filenames use lower-case kebab-case, with established suffixes such as `.test.ts` and `.spec.ts` |
| Terraform / HCL (`.tf`) | Use lower_snake_case for variables, locals, outputs and resource/data labels. Provider attributes retain their specified names. Remote resource names follow their provider constraints and the existing installation convention |
| Shell (`.sh`) | Use lower_snake_case for functions and internal state variables, and UPPER_SNAKE_CASE for exported environment variables and script constants. Keep naming consistent within the script; never repurpose standard shell/environment names |
| JSON (`.json`) | Use lowerCamelCase for new repository-owned application configuration keys. Preserve package/tool keys, external API fields, questionnaire definitions and other existing schemas exactly |
| YAML (`.yaml`, `.yml`) | Follow the consuming format: Compose fields such as `container_name` and `depends_on`, OpenAPI fields such as `operationId` and `requestBody`. Use lower-case kebab-case for repository-owned service IDs where supported |
| CSS (`.css`) | Use lower-case kebab-case for repository-owned class names and custom properties such as `--panel-background`; preserve framework utilities and CSS-defined names |
| Files and directories | Use lower-case kebab-case for repository-owned names unless the framework, tool or protected input requires a name such as `AGENTS.md`, `Dockerfile`, `README.md` or a Next.js route convention. See [repository structure](structure.md#workspace-ownership) |

Preserve names in external copies, generated outputs, API contracts and persisted schemas. An existing snake_case field used by an external API remains snake_case in its JSON/YAML representation and boundary type; internal variables may use camelCase through an explicit adapter. Do not rename stored fields, identifiers or public routes merely to normalize case. Treat any necessary rename as a compatibility change and update its consumers and migration requirements together. Apply these conventions when adding or changing maintained code, without unrelated bulk renaming.

## Boolean decisions

Require the actual boolean `true` when a value or function result grants success, permission or progression: use `value === true` or `check() === true`. Reject anything other than confirmed success with `value !== true`. Apply this at boolean decision points even when TypeScript declares a boolean return type; types alone do not validate runtime I/O or protect a caller when a return contract changes.

Objects such as `{ result: false }`, the string `"false"`, boxed booleans and unresolved Promises are truthy. Do not use `if (check())`, `Boolean(value)`, `!!value`, `value !== false` or boolean coercion schemas to turn them into success. Await asynchronous checks and compare the documented boolean field of a structured result, after validating untrusted input at its boundary.

```ts
const ready = await isReady()
if (ready !== true) return

const outcome = await checkPermission()
if (outcome.result !== true) return
```

Use `value === false` only when the operation specifically distinguishes explicit false from missing/invalid values; it is not a complete rejection guard for a success-required operation. If a format accepts strings, parse exactly `"true"` and `"false"` and reject other inputs before making boolean decisions. For non-boolean questions, express the intended condition directly, such as `value !== undefined`, `value !== null`, `items.length > 0` or `status === "ready"`. Do not mechanically turn presence or enum checks into comparisons with `true`.

## Comments

Write concise English comments, retaining exact UI labels and supplied texts where needed. Prefer ordinary `//` comments to explain non-obvious constraints or external behavior. Do not add JSDoc by default to feature-local functions, hooks, helpers or components. Reserve it for tool directives, shared contracts where hover documentation helps, and high-risk security, session, logging, runtime or external API boundaries.

## Ownership and protected inputs

In Web and Admin, keep feature UI, hooks, helpers, actions, services, schemas and tests together under `src/features/<feature>/`. Promote presentation-only reusable components to `src/ui/` and shared infrastructure without a feature owner to `src/lib/`. Support and shared packages may keep focused modules directly under `src/`; do not introduce feature/UI scaffolding without an actual owner. Follow [code organization](code-organization.md) for definitions and import direction and [repository structure](structure.md) for workspace/package roles.

Treat `src/lib/external/**` as read-only external copies. Do not change contents, formatting, exports or schemas without explicit authorization. Keep repository-authored adapters and tests outside that directory. Supplied Web research assets are also read-only unless their contents are explicitly authorized to change.

## Automated style checks

Root [biome.json](../biome.json) owns common formatting, lint and import-organization settings for maintained applications, packages and workspace scripts. App configurations inherit it; only Web/Admin enable Next.js, React and Tailwind-specific rules. Root `pnpm run lint` checks these owners, while `pnpm run format` writes formatting changes. Use the target-specific commands in [development](development.md#workspace-commands) for focused changes.

Private/configuration inputs, supplied research assets, external copies and generated/build outputs are excluded. The mixed generated contract `packages/contracts/src/participant-api.ts` is also excluded from Biome writes; schema changes use `pnpm run contracts:sync` and synchronization/consumer checks. Do not run broad safe-fix or formatting commands over protected inputs. Naming intent and boolean decision semantics still require review; Biome does not prove them.

## Tests

Keep unit, component and feature integration tests beside their source as `*.test.ts`, `*.test.tsx` or `*.test.mjs`, including script tests. Reserve package-root `tests/` for cross-package or package-wide contracts without a single feature owner. Keep Playwright `*.spec.ts` scenarios in `e2e/` and shared test-only fixtures in `test-support/`; feature-only helpers may stay with the feature. Use Vitest for application tests and `node:test` for existing workspace/config tooling. Exclude tests and helpers from production artifacts while preserving their validation.

Vitest and Playwright reject focused `.only` tests in local verification as well as CI. Select files or use the runner's test-name filter for focused work; remove `.only` before running verification. The tooling tests exercise this policy through each owner's installed runner with synthetic fixtures and no application services.

When organizing tests, group cases by the behavior they protect and share only fixtures used by multiple suites. Preserve assertions and parameterized cases when moving them. Remove an obsolete expectation only after checking the current implementation and retained compatibility paths; rejection of retired inputs, migration, exact retries and stale-owner protection may still be required. Scenario indexes belong in the owning test guide rather than AGENTS or skills; avoid duplicating exhaustive case lists in multiple documents.

## Logging and privacy

Use the owning application's structured logger. Emit at the route, action or top-level service boundary that has the operation context. Lower-level helpers return errors and safe context, or throw for unexpected failures; avoid duplicate logging. Pass caught errors only through a logger that redacts them, because raw SDK errors can include sensitive values.

Do not use `console.*` in client implementation. Show errors through UI behavior. Scripts use `console.error` for errors unless a dedicated script logger exists.

Never log raw or encrypted email, document bodies, prompts, model output, survey free text, cookies, session objects, auth headers, API keys or secret environment values. Web's event, redaction and request-ID details live in [Web logging](../apps/web/docs/logging.md); Admin and Support retain their own logger contracts.

## Review order

Review security/privacy, state/control flow, API compatibility, observability and configuration, in that order. Keep fixes, tests, examples and documentation aligned, preserve unrelated uncommitted changes, and report unresolved findings and unverified external behavior. Follow [workspace verification](../CONTRIBUTING.md#before-opening-a-pr).

For state/control flow spanning persistence, network calls or browser state, apply the [transaction design and review procedure](architecture.md#design-and-review-procedure). Repeated interruption fixes require revisiting the affected flow's commitment and acknowledgement boundaries before adding another retry or catch.
