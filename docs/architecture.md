# Architecture and data boundaries

See [data storage and protection](data-handling.md) for the cross-application inventory of collected/generated information, storage, encryption/hash locations and retention. [Study operations](study-operations.md) describes administrator recovery, indefinite participant authentication and explicit study-closure operations.

| Component | Responsibility | Persistent data |
| --- | --- | --- |
| [Web](../apps/web/docs/architecture.md) | Shared-browser sessions, local inference and result display | Allowlisted session metadata and credential digest in SQLite; HttpOnly credential cookie and sealed private browser context/result; no persistent server document/result storage |
| Local LM Studio | On-premises inference | Logging/retention controlled by the operator |
| [Support](../apps/support/docs/persistence.md) | Consent, study eligibility, analysis observations, survey acceptance and withdrawal | Firestore metadata/answers and Gmail; durable cleanup independent of Web |
| [Admin](../apps/admin/README.md) | Authorized monitoring, researcher recovery, exports and notices | Firestore/Cloud Logging; no analysis documents/results |
| [Configuration](../packages/config/README.md) | Explicit environment selection and runtime projection | Public examples/private configurations and generated settings |
| [Infra](../infra/README.md) | Reverse proxy and redacted logging | Operational configuration/logging |

Web sends documents/prompts only to the on-premises LLM. Authentication and survey APIs receive their own identifiers and payloads, including analysis metadata, but exclude document bodies and results.

Admin's participant views use the configured server scope. Notices, Cloud Logging and [source exports](../apps/admin/docs/data-export.md#complete-source-export) remain environment-wide. Authenticated mutations cover information records and researcher recovery authorization; neither stores analysis content. Server scope is not an IAM boundary.

Participation withdrawal is scoped to the pseudonym across deployments. Admin reflects Firestore data on page load/reload without a realtime requirement; current participant status includes cross-server withdrawal for the monitored participants. Its summaries are temporary, simplified operational displays; accurate research aggregation is outside their scope. Definitive aggregation/analysis follows the Support reception deadline: export the retained source data, select the appropriate records according to the study's criteria, and aggregate that selection offline.

## Participant persistence names

| Collection | Responsibility |
| --- | --- |
| `participationEvents` | Authentication request/retirement, confirmed consent, withdrawal and researcher recovery business history; required contact ciphertext |
| `analysisRuns` | Durable operational run summary, original/submitting owner, first receipt times, outcome, loss and research deletion markers |
| `accessEvents` | Immutable pseudonymous receipts committed with accepted operations; no contacts or research measurements |
| `withdrawalJobs` | Exact closed period, deletion progress and completion evidence |
| `participationStates` | Current consent boundary, study eligibility/browser restriction, recovery grant and withdrawal cleanup |
| `emailConfirmations` | Fixed email-confirmation identity/deadline and token verifier |
| `analysisAttempts` | Immutable start/terminal observations and first presentation record |
| `analysisQuestionnaires` | Completed-analysis metadata, presentation record and accepted questionnaire |

The participant API exposes `/api/participant/participation-events` for history and `/api/participant/analysis-completion` for completion metadata. Measurements use numeric `documentCount`, `documentGraphemeCount`, `resultGraphemeCount` and `processingDurationSeconds`. Graphemes describe character counts, not model tokens. All applications, API contracts and infrastructure must use matching contracts. Operational audit records and research payloads use the separate collections above. Deployment preserves existing data; database initialization requires a [separately scoped operator operation](study-operations.md#full-database-initialization). Cleanup preserves the current operational run projection atomically with research deletion; missing history is not reconstructed. Retained history without a participation state is rejected, as are questionnaire records without their exact metadata receipt.

## Participation and consent

Participant identity is the stable PID/pseudonym derived from normalized email and the identifier secret. Browser/client IDs identify browser sessions. First analysis through initial survey acceptance is protected in Firestore; completed/unanswered/unknown attempts do not authorize another initial analysis. After initial acceptance, separate browsers may perform follow-up analyses concurrently.

Before enabling consent submission, Web saves the fixed prepared request in sealed browser IndexedDB. Its ID, owner, ciphertext, withdrawal boundary and deadline survive response-loss retries. Sending mail does not confirm consent; normal email completion does. Expired/superseded preparation requires explicit rechecking.

After any withdrawal and confirmed cleanup, resumed participation requires a researcher grant and fresh consent/email confirmation. Admin reviews PID and one of three destinations, with reason, pseudonymous actor and timestamp in `participationEvents`. The grant applies once during renewed confirmation and installs a generation that rejects old consent mutations. It never restores deleted research content. See [renewed consent](../apps/support/docs/persistence.md#renewed-consent).

## Analysis and questionnaire records

These records describe different events and must not be combined into one completion count:

| Record or counter | Meaning | Limits |
| --- | --- | --- |
| `analysisAttempts` start | Acknowledged execution metadata before inference | IDs, timing and grapheme counts; no document/output |
| Attempt terminal observation | Completed, failed or cancelled execution | Does not establish browser display or answers |
| `analysisQuestionnaires` metadata | Finalized completed analysis, including `analysisWorkspaceVersion` captured at analysis start | Unanswered until accepted submission; original version retained on retries and recovery |
| `resultUnavailableAt` | Confirmed output loss | Keeps original attempt/terminal facts; protects presented initial results until initial survey acceptance and releases only an unpresented initial claim |
| `presentationRecordedAt` | Confirmed permission to display complete output | Written before display; a crash can prevent actual display |
| `analysisQuestionnaires.submittedAt` | Accepted questionnaire | First timestamp/payload retained on exact retries |
| `participationStates.initialSurveyAcceptedAt` | Initial workflow accepted | Releases other-browser restriction |

Unrecorded terminal outcomes remain **終了未確認**, including still-running work. Do not infer failure from elapsed time or fabricate attempts for old surveys. Withdrawal removes surveys and attempts, so surviving records are not an all-time participation denominator. [Admin aggregation](../apps/admin/docs/monitoring.md#survey-aggregation) shows counts only. Initial/follow-up item groups come from matching recorded attempts, not questionnaire-version values; scores and other averages are not calculated.

Web validates the selected [questionnaire definitions](examples.md#questionnaire-definitions) and records their canonical SHA-256 identity together with an answer map. Replacing definitions requires stopped operation and a rebuilt Web image whose definitions have been registered in the selected project’s Cloud Storage archive. Admin displays recorded IDs without loading question text; only research ZIP creation loads and verifies the referenced definitions, including older versions. Submitted responses without a questionnaire reference fail research ZIP creation; unsubmitted completion metadata does not require a definition. A failed questionnaire identity check leaves the browser result and answer draft intact and offers retry; only a confirmed mismatch is reported as a changed questionnaire.

## Local recovery and withdrawal

All tabs in one browser share SessionID without tab competition checks or awake requests. Result/survey views share a hash; screens and draft answers need not synchronize. Actions check current state and reject stale screens with reload guidance. Reload in any tab resumes observation of the same analysis; navigation does not cancel inference. Prompts and results may be retained temporarily in local Web process RAM, never persistent storage. See [shared browser sessions](../apps/web/docs/browser-sessions.md).

| Action | Local effect | Cloud effect |
| --- | --- | --- |
| Lost unpresented initial or unavailable follow-up output | Automatically returns to preparation after current-owner, durable completion/abandoned-process, RAM-loss and initial-presentation checks and Support acknowledgement | Records output loss, preserves original attempts/timing, and releases only an unpresented initial claim; never automatically infers again |
| Document/result deletion | Returns to preparation after initial/uncertain-submission guards | Preserves accepted events |
| Debug-only `/reset` | Revokes sessions, then clears origin cookies/storage regardless of busy state | Preserves study eligibility/history |
| Confirmed invalid-session recovery | Clears invalid session data and creates fresh unauthenticated admission | Preserves study eligibility/history |
| Withdrawal | Terminal state and confirmed browser cleanup | Deletes research/authentication records; retains consent/withdrawal/recovery audit |
| Researcher recovery authorization | New normal consent/authentication required | Records a reviewed one-use destination/target decision by PID, actor, reason and time; initial questionnaire recovery preserves original analysis provenance |

Withdrawal requires a matching email-confirmed consent; a pending confirmation cannot authorize pseudonym-wide deletion. Web exposes withdrawal only after authentication, with a separate terminal-state deletion retry. Committed withdrawal cleanup is durable even if the browser closes, its credential is lost or the user resets. The scheduled worker resumes pending deletions every 30 minutes from twelve hours before access starts until the independent Support backend stop, while the original session can also retry manually under its existing authorization. The schedule is not a completion deadline; persistent failures or unfinished work after the maintenance window require operator recovery. Renewed consent waits for cleanup. Withdrawal PDFs acknowledge acceptance and are available before deletion finishes. Consent PDFs use the latest email-confirmation date at download time in the session’s participation period, with withdrawal separating periods. Scheduled cleanup alone does not update the Web session’s deletion confirmation or resume participation. Web preserves the terminal withdrawn session and receipt access across reloads, with configured contact details for administrator recovery. Cleanup retains operational timestamps/outcomes, original and recovered submitting ownership, display/submission/loss facts, and deletion evidence while deleting research measurements, answers and their retry copies. Late terminal receipts can update an originally authorized historical run without restoring research payloads or changing the new generation. See [withdrawal cleanup](../apps/support/docs/persistence.md#participation-and-withdrawal).

## Transaction and failure boundaries

Classify operations by the facts they must preserve, not by whether they can throw.
A transport error is an unknown acknowledgement, not a rollback. Keep each accepted
business fact monotonic and retain its exact retry identity. Do not hold a server database
transaction across HTTP, mail, model execution, rendering or browser storage.
Browser IndexedDB transactions cover only browser state, with sealing requests
and server dispatch outside them.

| Operation | Atomic commitment | Interruption and retry policy |
| --- | --- | --- |
| Consent/email preparation | Fixed browser-sealed consent request before dispatch; Support commits confirmation and eligibility together | Reuse the prepared ID/payload. Mail delivery may repeat the same link; only confirmation establishes consent |
| Analysis admission | Web active ID and execution ownership in one SQLite transaction; Support start/initial claim in one Firestore transaction | Check local persistence, local model availability and Support authentication before claiming work. Require acknowledged start before inference; unknown starts remain protected |
| Analysis termination/cancellation | Immutable execution outcome/time; Support terminal fact and initial-claim release together | Preserve the RAM request until remote and local confirmation. Explicit retry resumes recording, never model execution. Cancellation does not clear ownership before confirmation |
| Result and survey | Browser generation/version checks and sealed retry replacement in one IndexedDB transaction; separate server completion, presentation and answer transactions | Preserve output and frozen browser answers. Confirm storage and presentation before display; retry the same accepted submission after lost responses |
| Withdrawal | Accepted withdrawal, participation boundary and durable cleanup job together | Acceptance is final. Resume bounded cleanup independently; local cleanup or receipt download cannot undo withdrawal |
| Administrator recovery | Grant and audit receipt together under reviewed record versions | Preserve the reviewed operation ID across response loss. Exact retry confirms its receipt without installing a replacement grant; changed targets require new review |
| Printing, PDF/Word download and exports | Read or render the selected snapshot/receipt; retain applicable access audit | Failure is local to delivery; Web document reads bypass the serialized mutation dispatcher. Offer explicit retry or the other authorized download path. Never roll back participation, block accepted withdrawal, substitute missing originals or regenerate research facts |
| Notices and operational displays | Version-checked notice edits/deletes; independent reads | Refresh after uncertain writes; no blind automatic retry of notice creation. Failed monitoring reads remain unavailable, never invented zero counts |

Readiness checks observe current availability and authorization; they do not reserve
future network, disk or model capacity. The actual admission/commit still checks its
own guards. Do not add mandatory checks for optional services, send sample documents,
automatically run inference, or introduce a cloud fallback. Expiring RAM and retained
audits serve different purposes: content cannot be restored after a process restart,
and audit-only delivery cannot authorize new initial work. Use the existing explicit
recovery paths when evidence is insufficient. See [Web recovery](../apps/web/docs/recovery.md)
and [Support persistence](../apps/support/docs/persistence.md) for the owning contracts.

### Design and review procedure

Apply this procedure when changing a workflow that spans persistence, network calls
or browser state, or when repeated interruption defects suggest that its boundary
needs redesign. Start with the accepted facts and their owners before adding retries
or catches.

1. Separate required commitments from optional delivery. Consent, analysis ownership,
   accepted answers, withdrawal and recovery authorization must not be lost or
   duplicated. Printing and downloads can fail with a clear retry or another
   authorized delivery path. Required commitment does not mean guaranteed availability:
   refuse to advance when acceptance cannot be established.
2. Map the phases: freeze input and retry identity, check required dependencies,
   reserve/admit work, commit each owner's facts, acknowledge them locally, then
   perform optional delivery. Identify the store and atomic transaction for each
   commitment. Local SQLite, Firestore and browser storage do not form one transaction;
   document the protected intermediate states and how they are reconciled.
3. Inspect interruption at every asynchronous boundary, including commit success
   followed by response loss or local persistence failure. Define what the user sees,
   which facts remain accepted, and whether the next action retries acknowledgement,
   resumes unfinished work or requires explicit recovery. Freeze the logical request's
   ID and payload outside retried transaction callbacks; keep irreversible external
   effects outside them. Preserve accepted timestamps and outcomes on exact retry.
4. Check cancellation, reload, concurrent requests and late responses against the
   current owner/generation. A local abort or timeout does not prove remote rollback.
   Permit exact authorized retries while rejecting changed payloads and stale ordinary
   writes. Do not repeat inference or grant new eligibility merely to recover a receipt.
5. Bound dependency checks and remote waits, including response-body reads, according
   to their owning operation. Check only prerequisites needed to begin expensive or
   stateful work; readiness never replaces commit-time guards. Explain unavailable,
   rejected and unconfirmed outcomes separately, retaining enough state for an explicit
   retry or reconciliation. Optional delivery failures need a usable retry, cancel or
   return path without blocking accepted business state. A fallback must preserve the
   authorized participant, requested record and data/privacy boundaries.

Prefer the smallest change that makes these boundaries explicit. Reuse the owning
transaction, retry receipt, durable job or recovery path when it fits; add durable
continuation only when work must survive the request/process. Avoid blanket retries,
compensating deletion of accepted facts and a new general workflow framework for a
local failure. Use automatic retries only where the owning contract permits safe
reads or exact replay, with a bounded attempt/time budget; otherwise offer explicit
user retry or recovery. Review the complete affected flow and equivalent consumers after a
fix. Select interruption coverage through [transaction verification](development.md#transaction-and-interruption-verification).

## Runtime and rollout boundaries

An opaque HttpOnly credential authenticates against its server digest; action stamps are checked against current server state. Email/retry context is sealed in browser IndexedDB and never saved in the server session database. Preserve the coordination volume and matching key; all workers share that database and independent multi-host replicas remain unsupported. Missing authority triggers fresh unauthenticated recovery, never restores old authentication. Firestore initial-workflow protection survives session loss.

Deploy matching Support, Web, Admin and contracts together. Preserve current Firestore facts and the current SQLite volume/key. Session authority and completed authentication have indefinite retention; verification requires retained completed authentication and current confirmed consent. Missing histories, ownership, outcomes and expired browser seals are never fabricated or revived. See [coordinated updates](study-operations.md#coordinated-updates). [Deployment](deployment.md#infrastructure-and-support-delivery) owns operational acceptance; local checks do not establish cloud, mail or operational-device behavior.

## Code ownership

Keep feature logic, tests and app-specific helpers in their app. [Root scripts](../scripts/README.md) orchestrate workspace operations. Shared packages have explicit responsibilities:

| Package | Shared responsibility | Application boundary |
| --- | --- | --- |
| [Configuration](../packages/config/README.md) | Target selection, runtime projection, secret providers and isolated launches | Applications consume their selected settings |
| [Participant API contracts](../packages/contracts/README.md) | Canonical request schemas, synchronized validators/OpenAPI and separate Node-only PID/DID helpers | Support owns authorization and transactions; Web/Admin use the appropriate exported contract |
| [Firestore](../packages/firestore/README.md) | Shared references, queries, research snapshots and information persistence | Support owns participant writes and authorization; Admin owns filtering and exports |
| [Participant PDFs](../packages/documents/README.md) | In-memory rendering and the Japanese font | Web/Admin own record selection, original verification, authorization and delivery |

Use stable package exports and preserve [dependency direction](code-organization.md#dependency-direction). Shared-package delivery and matching application versions follow the [deployment gates](deployment.md#shared-package-and-version-gates).

## Support API

The [Support application](../apps/support/README.md) owns the cloud API and email-token boundary. It preserves the persistence/withdrawal invariants and keeps analysis on premises. Test and production use independent projects, caller credentials, token keys and Gmail configuration. See [deployment](deployment.md) for delivery and acceptance.

Administrator recovery uses **研究責任者の復旧許可を適用** in production with a verified current browser credential/hash and pending Support grant. It can replace a stuck local fence, but opens ordinary consent/email verification rather than authenticated study access. Support atomically consumes the grant, binds the new owner, fences the old study generation and permits only the selected original analysis for initial-survey recovery. No result body is required or stored on the server. Exact recovered survey retries use the separate browser seal; original owner/presentation/first answers remain unchanged.
