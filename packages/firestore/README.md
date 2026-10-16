# Shared Firestore repositories

`@aerpp/firestore/information` provides `createInformationRepository(database)` for Admin and Support. The caller supplies an explicitly selected `@google-cloud/firestore` client and owns authentication, logging and transport. Do not import this entrypoint in browser code. `information-types` contains browser-safe validation and serialized types.

`listMessages` preserves Support response fields and Timestamp serialization. `list` returns Admin records with UTC date strings and precise `{seconds, nanoseconds}` update versions, newest creation first. Notice records require content, tone, expiry and creation timestamps; invalid stored records fail validation. `add` validates the existing participant contract and sets the creation timestamp. `update` and `remove` validate document IDs and require the version from a prior read; transactions reject missing or changed records without recreating them. Editing preserves the ID and creation timestamp. Creation is not idempotent; callers must not automatically retry ambiguous failures.

Records are environment-wide. No expiry filtering or TTL changes are introduced. Admin authentication and Support bearer operation checks stay at their application boundaries. Shared persistence introduces no access to documents or LLM results.

Run `pnpm run check:firestore` for type checks/unit tests and `pnpm run test:emulator` for Support HTTP and shared-repository integration. Next.js and Support's bundler consume TypeScript source. Docker contexts explicitly include the package and exclude tests.

## Participant references and queries

`@aerpp/firestore/participant-repository` exports `createParticipantRepository(database)`:

| Method | Persistence boundary |
| --- | --- |
| `participationEvents()`, `analysisQuestionnaires()`, `analysisAttempts()`, `participationStates()` | Collection references for Admin reads and explicit projections |
| `participationEventsFor(pseudonym)`, `analysisQuestionnairesFor(pseudonym)`, `analysisAttemptsFor(pseudonym)` | Exact pseudonym queries, with no implicit server restriction |
| `participationEvent(id?)`, `analysisQuestionnaire(analysisId)`, `analysisAttempt(analysisId)` | Record references; only `participationEvent()` without an ID generates a new reference |
| `analysisRuns()`, `accessEvents()`, `withdrawalJobs()` and corresponding `*For(pseudonym)` queries | Allowlisted operational summaries, accepted transition receipts and deletion progress |
| `analysisRun(id)`, `accessEvent(id)`, `withdrawalJob(id)` | Operational record references |
| `participationState(pseudonym)` | Existing SHA-256 pseudonym-to-document mapping, also exported as `participationStateId` |

References and queries accept normal SDK chaining (`select`, `limit`, `count`) and `transaction.get`. The repository performs no implicit reads, writes, authorization or retry loops. In Support, use `getParticipantRepository()` from the request-scoped storage adapter; do not cache a repository globally. Admin injects its server-only client. This preserves environment isolation and allows state/consent checks and mutations to remain in the same Support transaction.

Support still owns authentication, consent history, exact retries, immutable analysis observations, bounded withdrawal cleanup and mail sequencing. Admin still owns server filtering, questionnaire definitions, display normalization, aggregation and export authorization. Do not move these policies into a generic CRUD helper or bypass them with repository references. Authentication writes, debug-reset replay fences, rate limits and maintenance checkpoint storage remain Support-owned. Admin can read explicitly projected authentication metadata for authorized access exports.

## Research snapshots and values

`@aerpp/firestore/participant-snapshot` exports `readParticipantResearchSnapshot(database, { includeAccess })`. It reads every survey, attempt and explicitly projected consent/participant history in one read-only transaction without record filters. Optional caller-owned `limits: { maxRecords, maxBytes, pageSize }` fetch pages sequentially within that same transaction and reject the whole snapshot on capacity overflow. An optional `signal` prevents subsequent reads after cancellation; it cannot cancel an in-flight SDK RPC. The unbounded default remains available to existing consumers. The default excludes contact/authentication fields. Explicit `includeAccess: true` also reads projected `analysisRuns`, `accessEvents` and `withdrawalJobs` in that transaction and adds encrypted email to typed participation projections and reads all authentication records with an allowlist of identity/status/timestamp fields, never tokens, verifiers, nonces or credentials. Admin makes separate research and access downloads, each with its own snapshot. It decrypts contact email only when preparing access files; this persistence layer retains ciphertext. Records are sorted by document ID and failures propagate; failed reads never become empty datasets. Consent and participant projections include the retained withdrawal `hasCompletedAnalysis` decision (missing/null remains unknown), without restoring deleted attempt or survey details. Consent projections retain `consentRequestedAt`, `consentConfirmedAt` and `withdrawalAcceptedAt` when present; raw exports preserve their nanoseconds and missing values. Operational run projections retain original operation times/outcomes and original/submitting ownership without research durations, counts, answers or contacts. Admin excludes withdrawn research periods using the same snapshot before building research files. Display/submission acknowledgements belong to operational run/access projections; deleted research measurements and answers are not reconstructed. Consent/withdrawal projections use explicit event timestamps. Browser-safe DTOs are exported from `participant-snapshot-types`.

`@aerpp/firestore/values` keeps three distinct operations: strict SDK timestamp expiry checks (`isFutureFirestoreTimestamp`), millisecond ISO display strings (`firestoreTimestampToIso`), and precision-preserving nested export values (`serializeFirestoreValue`). Raw exports preserve stored timestamp seconds/nanoseconds, nonfinite-number markers and missing versus null values. These conversions do not replace application-specific date parsing or ownership validation.

Tests cover strict expiry, timestamp/export precision, projection and failure propagation. Emulator coverage exercises pseudonym queries, transactional reads, privacy projections, Support writes read through the Admin snapshot path, withdrawal visibility, and information CRUD. Support storage tests also verify concurrent request contexts cannot select each other's database.

## Data purpose

`@aerpp/firestore/data-purpose-types` provides the browser-safe stored-purpose normalization and operational filter values. Missing/invalid purposes normalize to `unclassified`, never `research`. Research snapshots explicitly project `dataPurpose` from consent and participant history; Support owns immutable classification. Admin operational views filter purpose; full exports preserve it for offline eligibility decisions. No mailbox lists are stored in snapshots. Current Admin filtering runs over the existing snapshots, so this change requires no new Firestore composite indexes, TTL settings or Security Rules. Server SDK enforcement remains in the application and IAM boundaries.
