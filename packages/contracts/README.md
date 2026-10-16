# Participant API contracts

`@aerpp/participant-api-contracts` owns the shared participant API boundary. Maintained sources live under `src/`, matching the other workspace packages:

- `src/request-schemas.ts` is the canonical request-schema source.
- `src/participant-api.ts` contains shared request/response validation and the generated request-schema block.
- `src/openapi.yaml` describes HTTP routes and security requirements.

Consumers use the stable `@aerpp/participant-api-contracts/participant-api` and `@aerpp/participant-api-contracts/openapi.yaml` exports. Do not import repository-relative paths or hand-edit the generated schema block. Run root `pnpm run contracts:sync` after schema changes and `pnpm run contracts:check` to check synchronization and OpenAPI. The contract-resolution regression tests live with their generator in `scripts/contracts/`.

The separate Node-only `@aerpp/participant-api-contracts/identifiers` export owns PID/DID derivation and Japan document-date construction. See [identifier contracts](../../docs/identifiers.md). Do not import it into browser code or the browser-safe API schema entrypoint.

This is a private workspace package with publicly tracked source. Runtime artifacts and secrets do not belong here; see [repository structure](../../docs/structure.md).

Consent-send and withdrawal requests require `documentSet: { version, sha256 }`; accepted participation records retain it. The scoped `readDocumentOriginal` route retrieves a verified original selected through an owned historical record, including after withdrawal. It neither grants participation nor stores completed PDFs. See [document sets](../../docs/document-sets.md).

Analysis completion requires `analysisWorkspaceVersion`, captured by Web when inference starts and retained in its completion receipt. It participates in exact metadata retries and is reserved against questionnaire answer IDs. Answer submission uses the existing `analysisId` linkage and preserves the original version, including administrator recovery; no version fallback or backfill is supported. See [research provenance](../../docs/research-release.md#release-provenance).
