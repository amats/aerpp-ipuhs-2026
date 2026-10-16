# Web structured logging

Follow the [workspace boundary and privacy rules](../../../docs/coding-conventions.md#logging-and-privacy). The helpers and sanitizer contracts below belong to Web.

## Development terminal output

Web development and debugger launches show sanitized application events with a
timestamp, level and event on the first line, then operational context on an
indented line. Repeated service/environment/version metadata is omitted from
this display. Production keeps the structured JSON envelope. Both outputs use
the same event allowlist, context filtering, identifier hashing and error
redaction; the display formatter receives only serialized, sanitized records.

Next.js Server Function invocation logs are disabled because their arguments
can include email and sealed session payloads. The Next.js access log for the
exact `/api/llm/analysis` endpoint is also suppressed to avoid repeated polling
lines; the URL filter applies to all methods and statuses on that endpoint.
Application lifecycle and failure/rejection events still appear. Other routes,
including `/api/llm/analysis/result`, retain their access logs. Restart the
development server or debugger after changing these settings.

## Events, sanitization and dependency retries

- Server logs should come from a scoped logger created by `createLogger(...)` or `createRequestLogger(...)`.
- Helpers that only wrap `logger.warn(...)` or `logger.error(...)` are allowed when they reduce repeated structured payloads, but keep `getSession()`, `session.save()`, and other boundary operations visible at the call site when that makes failure handling clearer.
- Define reusable event names in `src/lib/logger-events.ts`; avoid ad hoc inline event strings.
- Include the log `event` in the structured payload rather than relying on free-form messages. The emitted payload retains only names in `LOG_EVENT`; unknown names are omitted.
- When adding structured log fields, make sure the field is allowed by `SafeLogContext` and `SAFE_CONTEXT_KEYS` in `src/lib/logger.ts`; otherwise the sanitizer drops it silently. Add or update logger tests for new reusable fields.
- Use `warn` with `outcome: "rejected"` for expected user, session, or input rejection flows such as validation failure, stage mismatch, or auth mismatch. Reserve `error` for system failures, unexpected exceptions, and final domain-level failures.
- In `catch` blocks at a logging boundary, include the caught `error` unless doing so would risk logging sensitive data. Do not log only an `event` for failures that need debugging context.
- Keep `serializeError(...)` redacted: do not emit raw `error.message`, stack traces, prompts, document bodies, or LLM output. Use the existing hashed message field for correlation instead. Error names are limited to standard exception names; custom names, nested causes and SDK fields are omitted.
- Preserve `x-request-id` through route handlers and responses by using the request-id helpers in `src/lib/request-id.ts`.
- For external HTTP dependencies, use `fetchWithRetry(..., { logging: ... })` so retries and failures are logged consistently.
- Let `fetchWithRetry(...)` own transport-level retry and HTTP non-ok logging; do not override its level decisions at the call site. Individual retry observations use DEBUG; unconfirmed transport outcomes use WARN and remain distinct from a confirmed application failure.
- When a caller also logs a domain event for a failed `fetchWithRetry(...)`, keep the distinction intentional: dependency logs are transport-level observability, while domain logs describe the final application outcome.
- Authentication verification and withdrawal log a fixed `response_schema` failure when HTTP 200 has an invalid success shape. Successful HTTP transport alone does not establish a successful operation; never include response bodies or validator details in that diagnostic. Expected authentication refusal/pending states retain their existing result handling.
  These records mean Web could not confirm a valid response; they do not establish that Support rejected or failed to commit a withdrawal. Preserve the saved retry context and existing recovery behavior.
- `clientId` and `pseudonym` should only reach logs through the logger sanitizer.

## Withdrawal and research measurements

Operational logs retain timestamps, events, outcomes, linkage and transport diagnostics independently of withdrawal. New logs exclude document/result counts and sizes, model names and analysis processing durations. Do not reconstruct a research dataset from diagnostics. Previously emitted logs and proxy/platform logging have separate lifecycles. Withdrawal retains allowlisted operation times, outcomes, presentation/submission/loss receipts and recovery/deletion history in Firestore independently of logs; research measurements and answers are deleted.

Keep event granularity at business-operation boundaries. Support authentication confirmation, questionnaire acceptance, withdrawal acceptance/cleanup and Admin recovery authorization use durable transaction receipts instead of duplicate success INFO logs. PDF-generation success, acknowledged analysis completion/cancellation and individual dependency retries use DEBUG. Unconfirmed completion/cancellation remains WARN; failed analysis remains ERROR. Retain failure/rejection diagnostics, Web analysis observations that may lack a Support acknowledgement, and periodic maintenance INFO results needed by Admin monitoring. Do not add successful polling, rendering or per-batch logs. Exact retries are not new research observations. Never log personal information, ciphertext, arbitrary trace headers, filenames or URL queries.

## Audit queue diagnostics

`analysis_audit.queue.failed` reports local queue/storage failures with sanitized
error metadata. `analysis_audit.delivery.failed` includes only HTTP status and
attempt number; never the queued body or response. Successful drains are silent.
Repeated transport failures log on attempt 1 and powers of two. Durable Firestore
receipts and the SQLite queue, rather than repeated success/poll logs, retain the
operational evidence. Sparse logs do not replace checking blocked queue records. `analysis_audit.queue.stalled` reports only pending/blocked counts and oldest age: pending evidence older than 15 minutes is WARN, any blocked evidence or age of at least one hour is ERROR. Reports occur on severity transitions and at most once per five minutes for a continuing condition, including blocked notices retained across restart. Payloads and response bodies remain excluded.

The audit worker owns persisted retry scheduling and uses one bounded HTTP attempt
per lease rather than nesting `fetchWithRetry` retries. Its sparse failure event
is the transport diagnostic for that lease; no duplicate per-request success log
is emitted.
