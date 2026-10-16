# Configuration package instructions

Inherit [workspace guidance](../../AGENTS.md) and read the [package guide](README.md).

- Keep pure runtime readers separate from filesystem/profile loading and child-process launchers. Preserve `server-only` on the Web/Admin server entrypoints.
- Keep `.mjs` implementations, `.d.mts` declarations, exported names and type-contract tests synchronized. Preserve explicit environment selection, literal secret bytes and process isolation.
- Apply root `repo-config-env` for profile/projection/launcher changes and `repo-testing` to select checks. Use `pnpm run check:config`; affected consumers follow the [verification matrix](../../docs/development.md#verification-by-change).
