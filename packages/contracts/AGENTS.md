# Participant contract instructions

Inherit [workspace guidance](../../AGENTS.md) and read the [package guide](README.md).

- Edit request schemas in `src/request-schemas.ts`; regenerate the marked block in `src/participant-api.ts` with root `pnpm run contracts:sync`. Do not hand-edit or format that generated block.
- Keep runtime validators, shared types, OpenAPI, Support routes and Web consumers aligned. Use stable package exports rather than repository-relative source imports.
- Run `pnpm run contracts:check` and select consumer/emulator checks using the [verification matrix](../../docs/development.md#verification-by-change). Formatting excludes the mixed generated contract file; generated-copy verification remains mandatory.
