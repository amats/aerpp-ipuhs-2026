# Web development diagnostics

Source paths are relative to `apps/web`. Commands run from the workspace root; use the Web package filter or explicitly selected profile. These diagnostics do not establish browser or cloud acceptance.

## Environment validation modes

Shared-profile readiness uses root `pnpm run env:check test` or `production`, documented in [configuration](../../../docs/configuration.md). The app CLI below is a diagnostic tool and does not recreate old app-local settings.

- `pnpm --filter @aerpp/web run env:check` (also `--process-only`) validates only the supplied process environment; it never loads app-local dotenv files.
- Explicit diagnostic file paths passed to `scripts/validate-env.mjs` validate only those readable files, ignoring inherited application values; keep such files outside packages. The first file wins and values remain literal, without variable expansion.
- Use the [public example inputs](../../../config/example/README.md) for local defaults and the private-profile copy procedure; do not create package-local `.env*` files or examples.

## Codex sandbox in the devcontainer

The devcontainer is the outer Docker boundary, while Codex normally applies a second Linux sandbox to commands. Keep Codex in `workspace-write` mode for routine editing, linting, type checking, and tests. Do not switch the whole session to full access solely because one tool requires a capability that the inner sandbox blocks.

If the command never starts and the runner reports `bwrap: Can't mount proc on /proc`, the failure precedes Node and the repository scripts. Record the runner error and inspect the Codex/bubblewrap and container mount/namespace setup from a working terminal. `node apps/web/scripts/diagnose-sandbox.mjs` cannot diagnose a sandbox it cannot enter. If a scoped execution outside the inner sandbox is approved, record that scope: a successful probe there does not establish that sandboxed execution works. This devcontainer already uses `seccomp=unconfined`; do not infer that further permission changes are needed from a `/proc` mount error alone.

Run `node apps/web/scripts/diagnose-sandbox.mjs` when a Node-based test or tool reports `spawn`, `spawnSync`, or `EPERM`. Under some Codex Linux sandbox versions, a Node child process can finish successfully while anonymous-pipe stdout or stderr capture reports `EPERM` or returns empty output. Repository CLI tests use `test-support/spawn-captured.mts` to capture output through private temporary files instead, preserving process-boundary coverage inside the sandbox.

The diagnostic's file-backed probe uses the same capture helper. It preserves child exit status and output, and removes its temporary files and closes opened output descriptors if opening either capture file fails before the child starts.

The diagnostic reports raw `/proc/self/status` fields, `seccompFilterActive` (`null` when unavailable), and subprocess/loopback capabilities. It does not infer that the Codex sandbox is enabled or disabled from seccomp: filesystem isolation and runner policy require separate verification. Successful probes establish only that those operations work under the permissions used for the command.

Commands that inherently require child-process IPC, Docker access, or outbound network access may still need a narrowly scoped approval. Approve only the specific command prefix, keep the rest of the workflow sandboxed, and inspect outputs and generated files afterward.

Use the selected-profile build, such as `pnpm run env:run test web build`; `pnpm run build` performs synthetic workspace builds. Turbopack may use worker IPC that the command sandbox rejects. When a scoped exception is available and authorized, rerun that same build command under the approved scope; do not add a second build mode. Application release acceptance remains root `verify:release`.
