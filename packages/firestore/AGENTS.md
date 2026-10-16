# Firestore package instructions

Inherit [workspace guidance](../../AGENTS.md) and read the [package guide](README.md).

- Callers supply an explicitly selected database. Preserve the separation between server repositories and browser-safe type/validation exports.
- Support owns participant authorization, consent/retry/history decisions and write transactions; Admin owns filtering, aggregation and export authorization. Do not move these policies into shared CRUD helpers or add implicit queries/retries to reference helpers.
- Preserve timestamp precision, field allowlists and failure propagation. Use `pnpm run check:firestore`; persistence or cross-app projection changes also need the affected consumer/emulator checks from the [verification matrix](../../docs/development.md#verification-by-change).
