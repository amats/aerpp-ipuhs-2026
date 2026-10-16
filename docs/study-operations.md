# Study operations: recovery, session lifetime and closure

This guide describes the implemented study-operation policy and the operator procedures for reception changes and study closure. See [Architecture](architecture.md), [Web recovery](../apps/web/docs/recovery.md), [Support persistence](../apps/support/docs/persistence.md), [configuration](configuration.md) and the [data inventory](data-handling.md). Local tests establish application behavior; real host/cloud retention and operational deployment remain separate acceptance.

## Agreed operating assumptions

Plan for a one-year study, with 20–40 participants and normally fewer than ten concurrent users. Allow approximately twice that scale (up to 80 participants and around 20 concurrent users) in pre-release validation; concentrated arrivals are not expected. This is a validation envelope, not a new participant quota or a reason by itself to increase every resource limit.

Freeze algorithms, limit values, prompts/models/settings, questionnaire/UI wording and research data semantics after release, except for minimum necessary security maintenance. Reception-period changes use the private configuration during planned maintenance, followed by recompilation and deployment; do not implement an Admin date editor or cloud override. This operational setting change is not authorization to change other research conditions. See [research release policy](research-release.md#study-period-change-policy).

Documents and results have no server persistence or cloud copy. Encrypted email in consent history and sensitive Admin access-management exports are intended. Confirmed participant sessions have no application-imposed expiration; email confirmation links retain their short, fixed expiration. Server restarts retain the SQLite DB and keys and must preserve valid sessions. Data loss outside the first-result/initial-questionnaire boundary is acceptable for recovery, provided stale work cannot overwrite the recovered state. Administrator-assisted recovery remains the fallback when server recovery or browser reload cannot resolve the incident.

At study completion, remove the operational Web server and its server DB. Extract the required research and management data through Admin and verify the downloads before deleting the cloud project. These are end-of-study operator actions, not automatic participant withdrawal and not actions performed by this implementation.

After any withdrawal, resumption requires administrator recovery followed by fresh consent/email confirmation after cleanup. The withdrawn Web screen provides the configured contact and document-download access; it does not return automatically to start. Cleanup retains allowlisted operation times/outcomes, presentation/submission/loss receipts, authentication and recovery history, study eligibility and deletion progress in Firestore. Delete answers, `_integrity` copies, document/model measurements and recorded research durations. `analysisRuns`, `accessEvents` and `withdrawalJobs` retain operational evidence independently of research payloads. Research exports exclude withdrawn periods without reconstructing durations from access times.

## Implemented behavior and operational boundaries

| Requirement | Behavior |
| --- | --- |
| No persistent server/cloud document or result copies | Browser seals and on-premises transient RAM only; actual host/LLM/proxy logging remains operational verification |
| Preserve participant identity across restart and reception changes | SQLite credentials/state and newly issued browser seals have no application expiration; retain the volume and keys |
| Protect first viewed result / initial questionnaire | Normal flow records presentation permission before display; an administrator reviews actual viewing when recovery is needed |
| Practical recovery | Release demonstrably dead Linux-process operation ownership, retain uncertain execution/dispatch facts and retry original survey requests |
| Administrator destinations | Initial documents, original initial questionnaire without inference, or follow-up documents; review/confirmation, one-use grant and renewed email confirmation |
| Reception maintenance | Private configuration, rebuild and matching deployment; no Admin runtime editor |
| Study closure | Explicit extraction, verification and server/DB/project deletion by the operator; no automatic deletion performed by this implementation |

## Restart and ordinary recovery

Keep session validity separate from the lifetime of an in-flight operation. A restart with retained DB and keys must not force all participants to authenticate again. A stale screen may reload; an available browser result remains usable. Never recover by deleting the coordination DB or rotating keys.

On Linux, retained operation ownership includes host boot identity, PID and process start time. Reads release only ownership whose process has ended or changed, preserving the credential and business hash. Analysis observation uses the same execution identity to recognize abandoned RAM output without declaring the attempt failed. Do not use elapsed time alone to cancel a live analysis or label an unknown cloud write as failed. Preserve exact retries for accepted or uncertain survey/consent/withdrawal writes. Before first presentation, unavailable output recovery records that fact in Support and returns to document preparation without inventing its execution outcome or starting inference. The participant initiates any replacement analysis. Follow-up output loss may likewise return to preparation even after presentation. Frozen uncertain survey submissions still require exact retry. Unavailable ownership checks and unsupported hosts retain the administrator fallback. No automatic reanalysis is needed.

If the server cannot establish a safe transition, keep the session evidence and offer reload/administrator contact. The administrator reviews the participant's report alongside stored attempt, presentation, submission and withdrawal facts. This fallback is intentional; there is no requirement to automatically resolve every ambiguous incident.

## Administrator-selected recovery destinations

Use one recovery destination field rather than combinations of independent booleans. The administrator must authenticate, identify the participant, review the affected records, choose the destination and provide a short reason without document/result content.

| Destination | Administrator's finding | After successful participant reauthentication | Preserved boundary |
| --- | --- | --- | --- |
| Initial document preparation | **初回解析結果参照前のため初回の書類入力画面に戻す** | Initial document-entry screen; a participant-initiated new analysis is allowed | Preserve prior attempt facts and the recovery decision. Do not pretend a completed/unknown attempt failed or erase a recorded presentation |
| Initial questionnaire | **初回解析結果参照後のため初回アンケート入力画面に戻す** | Initial questionnaire for the identified original analysis; no new inference | Reuse retained original analysis/completion linkage, preserve actual presentation records and first accepted answers. Result loss must not prevent questionnaire entry |
| Follow-up document preparation | **フォローアップ状態の書類入力画面に戻す** | Follow-up document-entry screen | Record the administrator's eligibility decision; never fabricate an initial questionnaire submission merely to select follow-up |

For initial-questionnaire recovery, require an identifiable retained completed initial analysis and no already accepted initial answer for that target. Display the target analysis ID/timestamps and submission status for confirmation. A presentation permission alone does not prove the participant viewed the result; record the administrator's reviewed decision separately without rewriting the original presentation timestamp. If the original metadata was deleted by withdrawal or the target cannot be identified, explain that this destination is unavailable; do not fabricate an analysis or resurrect withdrawn research data. An already accepted answer must not be overwritten or counted twice.

The recovered questionnaire must work without a browser result body. The recovered questionnaire omits return-to-result controls and does not adopt an old-owner result into the new authenticated owner. Result export still requires its normal authorized browser envelope. Keep unsent answer drafts in browser memory and freeze submission retries in the separate `aerpp:recovered-survey` owner-bound browser seal. Reload restores the frozen answers and disables editing; an identical retry preserves the first accepted answers and timestamp. Do not create a dummy result or add answer/document storage to SQLite.

### Authorization and reauthentication

In Admin **参加者**, enter PID or select **メールアドレスからPIDを生成して照会**, then use **PIDの記録を照会する**. Review the displayed current participant state, consent/withdrawal/recovery history, analysis attempts and completion/presentation/submission timestamps. The current state is environment-wide; histories use the configured server scope across all purposes. A missing record or recorded presentation permission does not establish whether the participant saw the result, so confirm with the participant. Lookup is read-only and does not retain or log the entered email. See [the lookup contract](../apps/admin/docs/monitoring.md#researcher-recovery).

After that review, select **復旧先**, supply the original analysis ID for an initial questionnaire (or use the current initial claim), and a content-free reason. **対象を確認する** reads the decision's records; **確認して復旧を許可する** checks their exact Firestore versions again before committing. Any intervening change requires a new review. Repeat lookup to refresh the displayed history after a decision. Participants then use the Web recovery control, consent again with the same email, confirm its new email link, and continue from the authentication screen.

1. Review the current participant/target first, then explicitly confirm and atomically save a pending, one-use grant with participant ID, destination, target analysis ID when needed, reason, actor ID, timestamp and expected study generation. A replacement grant supersedes an unconsumed older grant; stale Admin forms must reload before overwriting a newer decision.
2. The production Web control **研究責任者の復旧許可を適用** is usable even when the old browser operation is stuck. Ordinary reload alone does not consume the grant. Check the server-side grant before permitting a controlled move to normal email verification; Support rechecks study/withdrawal boundaries during issuance and consumption; do not expose the debug reset or make knowledge of PID sufficient for recovery.
3. Require normal email reauthentication by the same participant. No email-verification bypass. Preserve the consent/withdrawal history; withdrawn participation still requires completed cleanup and the normal renewed-consent rules.
4. Consume the grant once in the same transaction that binds the newly authenticated owner and recovery destination. Fence the superseded study generation and pending authentication links. Repeated responses/reloads resume the same accepted recovery; they cannot consume a replacement grant or overwrite later work.
5. Return the trusted destination and required content-free linkage through the participant API. Web installs the corresponding local state and opens that screen. The selected destination is not a client-submitted permission, and failure of a local write must leave an idempotent recovery path.

For the questionnaire destination, allow the newly authenticated owner to submit for the explicitly authorized original analysis while preserving the original record's consent/client/server provenance. Store recovery/submission linkage separately; changing the original owner fields would relabel research history. Enforce this narrowly in Support, not by generally relaxing survey ownership checks. Record recovery destinations and consumption in access exports, with no document/result content.

This intentionally creates fresh authentication for administrator recovery. Ordinary server restart remains a different path and preserves valid existing sessions.

## Participant session lifetime

There is no application-imposed expiration on **confirmed participant authentication**. Reception opening/closing determines whether a study operation is allowed, not whether the retained participant identity is valid. A closed reception screen may prevent analysis or survey submission without destroying the session. Reopening after a reviewed configuration deployment should reuse retained authentication, provided it has not been revoked or replaced.

| Boundary | Implemented behavior |
| --- | --- |
| Web SQLite and cookie credential | SQLite retains authority and revocation fences indefinitely; there is no stored reception-deadline equality check. Keep credential digest, identity, revision and explicit revocation validation across restarts/builds |
| Browser private context and result seals | New browser-only seals use `ttl=0`. Keep integrity and current owner/generation checks; never persist the payload on Web |
| Browser cookie/storage lifetime | Admission renews the same opaque cookie with 400-day browser retention without changing its credential or business state. There is no application authentication deadline. Browser deletion/eviction or loss of the credential can still require normal reauthentication; a server must not restore authentication from SessionID alone. Do not promise perpetual browser retention or use a browser-session-only cookie as the persistence design |
| Confirmed cloud authentication | Verification requires completed authentication and current confirmed consent. Completion removes `expireAt`, duplicate email and nonce, retaining durable authentication proof |
| Pending email confirmation | Keep the original short, fixed link deadline and single-use verification. Maintenance/period extension does not extend or revive an expired link; send a fresh link through the normal authorized flow |
| Revocation and recovery | Withdrawal, explicit reset, administrator recovery and confirmed invalid credentials still invalidate/supersede authority. Never resurrect old cookies/links. Revocation evidence has indefinite retention |
| Admin and service authentication | This change concerns participant sessions. Admin Google login, OAuth access tokens, caller credential authorization/revocation and Scheduler OIDC retain their own security contracts |

Avoid introducing an indefinite duplicate email archive merely to keep authentication valid: consent history already retains the contact ciphertext. Select the minimal durable authentication evidence and retain necessary exact-retry semantics. Preserve the DB and matching secrets throughout the study; scope eventual deletion to [study closure](#study-closure-and-deletion).

## Reception changes during maintenance

Keep private `config.json` as the only editable reception-period source. Do not add a Firestore reception-policy record, a runtime override or an Admin editing screen. Use the maintained configuration/build/deployment workflow for a reviewed extension or shortening; never hand-edit generated runtime files.

Before deployment, validate start before end, explicit timezone (operator review in Japan time), selected environment, old/new dates and reason. Check the effect on current analysis, unfinished questionnaires, pending confirmation links and scheduled cleanup. No prompt/model/wording/resource-limit changes belong in this maintenance action. Rebuilds also refresh auxiliary images under the current delivery workflow, so review those changes against the study/security maintenance policy.

Deploy matching Web/Support settings and both Admin deadline displays, preserving the session volume, credential identity, sealing key and identifier secret. Reception-related changes must not invalidate or replace participant sessions. Shared `support.access` supplies Web reception and Support caller identity/start/revocation. The independent `support.access.backendStopsAt` ends Support caller acceptance and scheduled maintenance; it must be at or after Web reception ends. Review it separately and leave time for delayed audit delivery and committed cleanup. Unexpired pending confirmation links retain their original deadlines; Support checks backend availability and caller revocation when they are used.

Allow active inference/completion acknowledgements to settle before planned replacement; Web RAM is not durable. Stored pending/unknown attempts and unanswered-survey counts assist operator review but cannot prove whether a browser is viewing a result or holding a draft. Do not add tab heartbeats or server document storage to obtain that information. An unavoidable interruption follows ordinary/server/administrator recovery above, without deleting the DB.

Web reception closure still gates Web study operations, while Admin monitoring/export remain available and Support continues accepting authorized requests until backend stop. A shortened backend window must not strand committed cleanup; finish it during maintenance or use the existing operator recovery. Backend stop prevents subsequent acceptance and worker runs; it does not drain every in-flight request or power down Cloud Run. Reopening preserves unrevoked authentication but does not undelete withdrawn records or restore missing browser data. There is no new automatic grace period or second questionnaire deadline.

## Study closure and deletion

1. End participant reception and resolve or explicitly record unfinished analysis, questionnaire and committed withdrawal-cleanup cases. Keep Admin available for final data extraction.
2. Remove the operational Web server and retained SQLite coordination DB/volume after participation has ended. Review remaining on-premises runtime/bundle files and keys as part of retiring that server. This ends local session continuity permanently; it is different from a maintenance restart.
3. Use Admin to download both the research and access-management datasets, including the questionnaire definitions in the research ZIP. Verify that the archives open, source rows/counts and linkage are usable, required contacts are readable, and withdrawn research data are handled in any previously downloaded copies. Keep the sensitive management archive separate from research data.
4. After confirming the required extraction, delete the explicitly selected study cloud project, including the applications and their project-owned data. Existing infrastructure deletion protections require a deliberate end-of-study operator procedure; do not disable them as part of routine deployment or assume a successful export deletes cloud data.

Project deletion is the chosen end of cloud service/data retention, not a new automatic TTL on consent history. Record deletion completion under the provider's actual lifecycle rather than asserting immediate physical erasure. Downloaded ZIP/PDF/Word files, participant original files, browser storage, Gmail sent/received messages and copies outside that project have separate owners; deleting the Web server or study project does not remove them. In particular, encrypted browser-storage bytes can remain after server/key disposal even when no longer readable through the application. Keep necessary offline research/management exports under the study's retained-data policy.

## Capacity and pre-release verification

| Current bound | Relevance to the agreed scale |
| --- | --- |
| 20 retained Web analysis jobs, including terminal jobs held up to 10 minutes | Normal use below ten simultaneous participants has headroom. Around twenty active users plus delayed acknowledgements/failed retry prompts can exhaust it; test that boundary before freezing values |
| 15-minute inference timeout, 500,000-byte final result, 8 MiB response, 20 documents/30,000 graphemes | Adequacy depends on the fixed model, representative synthetic input and operational hardware. Participant count alone does not validate these bounds |
| 30 mail attempts/hour per Web caller, five/hour per recipient with 60-second spacing | Distributed arrivals make saturation less likely. Retries count too; test understandable recovery at the limit without assuming a flood |
| 10,000 retained local session rows, with 1,000 reserved for recovery | Ordinary admission stops at 9,000 rows. This counts browser generations/anonymous admissions/revocation markers, not people. 80 participants alone does not imply exhaustion, but repeated browser clearing over a year and the non-expiring authority/revocation records must be included in the estimate |

Sources: [authority limits](../apps/web/src/lib/session-authority-constraints.ts), [allocation](../apps/web/src/lib/session-authority.ts), [job limits](../apps/web/src/features/llm/analysis-job-constraints.ts), [document limits](../apps/web/src/features/document/document-constraints.ts) and [mail limits](../apps/support/src/email-authentication.ts). This implementation changes no limit or generation setting.

Application acceptance covers all three destinations after email authentication; replayed/replaced grants; stale tabs and delayed writes; saved versus lost initial output; already submitted/deleted targets; response loss during grant consumption/submission; restart with retained SQLite/key and abandoned locks; and browser reload without unwanted authentication loss. Include received-but-not-rendered presentation in the administrator decision scenarios.

For session/period changes, test restart/rebuild with retained credentials and browser seals, extension/shortening without authentication loss, continued rejection of expired/consumed links, missing browser credentials, revocation after long retention, old-generation retries, reception closure/reopening and cleanup beyond reception. Verify expiry-free confirmed authentication cannot be removed by pending-link TTL. Run applicable contract, unit, emulator, build and browser checks from the [verification matrix](development.md#verification-by-change). Real cloud, Gmail/OAuth, runtime credentials, model/hardware, final export/deletion and operational host persistence remain separate acceptance; local application verification does not establish them.

## Coordinated updates

Deploy matching Web, Support, Admin and contracts before use. Keep the SQLite volume, sealing password and identifier secret for current-schema sessions. Validate stored state against the maintained contracts; verification requires both retained completed authentication and current confirmed consent. Missing histories, execution outcomes and browser state are never fabricated or revived.

## Schema validation and retention

Ordinary releases preserve keys, participant eligibility and retained audit history. Review the stored schema and asynchronous TTL policies before changing writers; the application performs no automatic database reset or migration. Validate fresh installations with synthetic data using the maintained schema. Full database initialization follows the separately authorized procedure below.

Operational runs, access receipts and withdrawal jobs remain in Firestore independently of research payloads. Admin recovery reads these facts, but permission still requires its durable grant and matching state pointer, then fresh consent/email confirmation. Physically deleted research is unavailable for recovery. Authentication request history survives challenge expiry; completed proofs retain their existing indefinite validity. [Data handling](data-handling.md) owns the personal-information and download exceptions.

## Full database initialization

A full reset is an explicitly scoped operator operation, separate from ordinary
updates, participant withdrawal and the debug `/reset` page. The application has
no server-history erasure endpoint. Debug `/reset` clears browser/session state
and retains server revocation evidence, Firestore history and study eligibility.

1. Select the environment/project and inventory every Web installation connected
   to it, including operational machines, local debug Web, development containers
   and any stopped instance that could restart with old state. Review retained
   data/queue disposal within the authorized reset scope. Drain the audit queue
   or explicitly resolve its outstanding notices before discarding it.
2. Stop all target Web processes/containers and suspend Support data writes and
   maintenance. Update every target installation to matching Web/Support/Admin
   source and contracts before resuming. Fence old installations from reconnecting
   and replaying writes into the fresh database.
3. Initialize the selected Support Firestore database, or its isolated local
   Firestore Emulator when that is the selected backend. A debug Web connected
   to test cloud uses that test Firestore; resetting an unrelated emulator is
   insufficient. Keep infrastructure, archive retention, Terraform state and
   application keys within their separately reviewed ownership boundaries.
4. Initialize each target Web's SQLite coordination database, including **local
   debug Web**. Its path is `<os.tmpdir()>/aerpp-coordination/<key namespace>/server-sessions.sqlite`;
   Linux normally uses `/tmp`, while the actual Node process's `TMPDIR` and
   development-container filesystem can select another location. Docker uses the
   retained `web-session-coordination` volume at `/tmp/aerpp-coordination`. Resolve
   the intended key namespace without printing the sealing key. With all writers
   stopped, handle the database and its `-wal`/`-shm` companions together. This
   resets local authority, revocation/fence metadata and the `analysis_audit_outbox`
   stored in the same database. Clearing Firestore or its emulator does **not**
   clear this SQLite file; replacing an image also preserves its Docker volume.
5. Clear the affected browser origins' old cookies, local/session storage,
   IndexedDB and caches, including debug browsers. Verify fresh Web authority,
   empty old outboxes, intended Firestore/Emulator contents and fresh session
   admission before reopening operation. Recreate required initial application
   data deliberately; never replay old queues to reconstruct research records.

Do not delete a live SQLite file or blanket-delete temporary directories, private
configuration or generated operation evidence. Normal deployments preserve both
Firestore and Web SQLite; no startup, update or reset button performs this full
initialization automatically.

## Retained Web audit queue

Preserve the Web coordination volume and matching sealing password across ordinary
restarts/replacements. The queue shares `server-sessions.sqlite` under
`/tmp/aerpp-coordination/<key namespace>/` in the retained Docker volume. A new
password selects a different namespace; this is not queue migration or erasure.
Do not delete that volume to recover a participant. Restarting Web resumes pending
notices without keeping documents/results/answers or research durations on disk.
Support caller scopes must include `recordAnalysisOutcome` before delivery.

Use a local SQLite connection to the selected installation's actual file to
inspect aggregate queue status. Do not export payloads into logs or tickets:

```sql
SELECT status, COUNT(*) AS count FROM analysis_audit_outbox GROUP BY status;
SELECT lastCode, COUNT(*) AS count FROM analysis_audit_outbox
WHERE status = 'blocked' GROUP BY lastCode;
```

A blocked notice is retained evidence, not completed delivery. Review 400 schema,
403 caller scope and 409 owner/start/outcome conflicts against the intended Support
environment. After correcting a configuration/scope problem, an operator can reset
only the reviewed rows to `status = 'pending'`, `nextAttemptAt = 0`,
`leaseToken = NULL`, `leasedUntil = 0`; do not change their owner/outcome payload.
Conflicting or missing starts require record review, never fabricated research.
Retain unresolved notices; clearing them is a separate explicit operator decision.
An at-capacity or unavailable store prevents confirmed terminal delivery and Web
keeps its in-memory retry state. Check queue failures before stopping that process.

Before a planned full pre-study DB reset, drain and verify the queue or explicitly
resolve its retained notices as part of that reset. A stale queue pointed at an
empty cloud database receives a missing-start conflict; it cannot rebuild research.
The reset itself and disposal of retained audit evidence require the operator's
chosen scope; routine fixes do not perform them.

## Restoring database backups

Restore into an isolated target with participant traffic and queue delivery stopped.
A backup predating withdrawal may contain deleted research and outdated consent,
claim or recovery state. Restore the latest authoritative withdrawal boundaries,
cleanup jobs and access/consent/recovery receipts before reopening writes. Re-run
withdrawal cleanup and verify research exclusion against those boundaries; retain
operational evidence instead of erasing participant history indiscriminately.

If later withdrawal/recovery history is unavailable, an old backup alone cannot
establish safe current participation. Keep it isolated for operator reconciliation;
do not treat absence of a withdrawal in that backup as consent to restore research.
Admin recovery authorizes a new reviewed destination and fresh authentication,
not restoration of deleted research. Verify the matching Web volume, server scope,
keys and Support target before restarting queued delivery. Real cloud restore,
OAuth/mail, multi-process restart and device acceptance remain deployment checks.
