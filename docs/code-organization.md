# Web and Admin code organization

These conventions apply to Web and Admin. Source paths are relative to the affected app. Follow [coding conventions](coding-conventions.md) and [repository structure](structure.md) for test placement and read-only external copies. Shared rules do not imply moving application code into a shared package.

For app/package root directories, private and generated output and publication boundaries, follow [repository structure](structure.md). Keep package implementations and exported contracts under `src/`, and shared test-only helpers under `test-support/`. Preserve framework-specific output names; equivalent roles need the same meaning, not unused matching directory trees.

## Definition files

- Name definition files by responsibility, for example `*-types.ts`, `*-schema.ts`, `*-constraints.ts`, `*-constants.ts` or `*-regexp.ts`.
- Use `*-types.ts` for type contracts, including hand-written TypeScript types, Zod schemas defining domain/request/response types, directly derived `z.infer` aliases and related type re-exports.
- Keep a Zod schema and its directly derived type in the same file. Use `*-schema.ts` when the primary responsibility is a reusable parsing schema rather than a domain type contract.
- Keep feature-local definitions in their feature. Multiple consumers alone do not override domain ownership.
- Do not mix unrelated constants, schemas, env-derived values and UI state contracts unless they always change together.

## Area ownership

- `src/app/**`: Next.js routes, layouts, Route Handlers and route-level component composition. Keep feature workflows in their owning feature.
- `src/features/**`: feature UI, hooks, helpers, actions, services, schemas, orchestration and nearby tests.
- `src/lib/**`: shared infrastructure, framework adapters and cross-feature contracts without a domain-feature owner.
- `src/ui/**`: presentation-only components reusable across features.
- `scripts/**`: app-owned operational helpers; workspace orchestration stays in root scripts.

Use feature-local `use-*` hooks for reusable stateful workflows, focused testing, or to make a large component easier to follow. A single component may retain UI and orchestration when that is clearer. Pure transformations, validation, formatting and file conversion stay in feature-local helpers when feature-owned.

Use the [Web ownership map](../apps/web/docs/architecture.md#ownership-boundaries) or [Admin ownership map](../apps/admin/CONTRIBUTING.md#ownership) for concrete responsibilities, including each app's Proxy. Update the affected map when an ownership boundary changes.

## Dependency direction

- Keep the normal direction as `src/app/**` to `src/features/**` to `src/lib/**`, with features also consuming `src/ui/**`.
- Do not import application, feature or presentation areas from `src/lib/**`. Keep `src/ui/**` independent of feature orchestration.
- Prefer direct imports over broad barrels that obscure client/server or feature boundaries.
- Use service/helper modules for shared server logic; follow [Server Function boundaries](nextjs.md#server-functions-and-cookies).
- Applications must not import another application's source. Shared packages must not depend on applications. Cross-owner package imports use named package exports, never repository-relative source paths or unexported subpaths.

Run `node scripts/checks/check-boundaries.mjs` from the workspace root for all app/package source trees, or append an owner such as `apps/web`, `apps/admin` or `packages/firestore`. Owner lint commands include the same check. It covers `lib`/`ui` direction, external-copy dependencies, app isolation and named package exports for literal static imports/re-exports, dynamic imports and `require`. Static declarations may also use contextual names such as `from` and keyword-named imports or exports. Computed module names, additional aliases and architectural cycles still need manual review; keep workspace source aliases limited to the documented `@/` mapping and package exports. Web's more specific `@/assets/*` mapping resolves reviewed MDX inputs from app-root `assets/` or `assets-public/`, outside `src/`; the complete selected set is validated before Next.js starts. The derived build-only `AERPP_WEB_ASSET_SOURCE` marker pins PDF readers to that compiled set; it is not a runtime operator setting.
