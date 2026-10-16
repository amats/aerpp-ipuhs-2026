# Recovery and retry decisions

This guide owns the Web decision criteria for automatic continuation, explicit retry, reload and researcher assistance. Read with [session contracts](session.md), [analysis coordination](analysis-coordination.md) and [participation](participation.md) for the server guards and durable evidence required by each workflow.

## Decision criteria

Choose recovery from confirmed state and the effects of the interrupted operation. A communication or storage error alone does not establish invalid authentication, failed inference, rejected answers or accepted withdrawal. Preserve input and the original retry identity while the outcome is uncertain.

| Situation and purpose | Response | Data and effect boundary |
| --- | --- | --- |
| Initial session admission cannot complete, including transport/storage failure or a pending first cookie | Offer **セッションの確認を再試行** in the current page | Retain browser data; retry admission only, without resending consent, documents or answers |
| Admission confirms unusable authority or credentials | Admit fresh authentication independently; reuse a verified replacement when available. A claimed generation ID without its valid credential never authorizes revocation | Clear invalid-generation browser data only after confirmation; accepted Firestore facts and study eligibility survive |
| An ordinary operation detects a pending administrator recovery grant | Stop the operation and open `/recovery`; confirm the displayed destination before discarding local work | Recovery requires the current credential/hash and the same unused grant. No automatic consent, inference or Firestore deletion |
| Administrator recovery is accepted but browser cleanup or its acknowledgement fails | Reload `/recovery` and resume the accepted reset | Ordinary mutations remain blocked until browser cleanup is acknowledged. Preserve newly prepared consent after that point; never restart destructive cleanup after grant consumption |
| Recovery email is confirmed while its send acknowledgement or local transition is lost | Reload, re-enter the same email and retry the saved consent request, then continue authentication | Verify the exact dispatched owner before reusing the sealed request after grant consumption. Completed confirmation can outlive the pending deadline; preserve the original ID and payload without another grant or reset. Replacement grants, changed boundaries and a grant consumed by another consent remain rejected |
| Ordinary operation returns `session_busy` | Wait, then explicitly retry the same operation | Keep inputs and pending completion output; do not reload or silently repeat the mutation |
| Current screen/hash, analysis identity, stage or private context is rejected | Stop ordinary actions and offer reload | Retain browser data until the participant reloads; admission then verifies the actual session. Do not automatically adopt another tab's screen or reset shared work |
| A rendered section does not permit the current stage | Show the same reload guidance without a transition | Rendering an inconsistent screen must never call `resetToStart` or mutate shared participation |
| An older operation/response is superseded by navigation, withdrawal or session replacement | Ignore its continuation | Never overwrite the destination, replacement generation, context, results or answers |
| Reload/navigation interrupts observation of a valid analysis | Automatically resume read-only observation of the same attempt | Never resubmit documents or infer again; inference runs independently of the page |
| The matching result is saved in the browser and presentation is already confirmed | Restore it and permit result/questionnaire navigation even after Web restart | Validate current authority, analysis ID and questionnaire information. Do not require RAM output, resubmit presentation or compete for a business-operation fence |
| Analysis readiness fails before admission | Explain that analysis has not started; retain input and offer return to preparation | No study claim or model request has been made; the next explicit start checks dependencies again |
| Analysis transport fails or an inference retry/cancellation response is uncertain | Offer **接続を再確認** to read the same attempt | Confirm the actual outcome before another model request or recovery mutation; retain the document draft |
| Inference has ended but its failed/cancelled terminal delivery is unacknowledged | Offer **終了記録を再試行** while the frozen RAM request remains available | Resend only the same outcome and timestamps; do not infer again, clear authority or release initial eligibility without Support acknowledgement |
| Completed output is available but terminal recording, finalization, storage or presentation fails | Offer **完了処理を再試行** | Retain the original output/receipt and retry completion only; output stays hidden until storage and presentation are confirmed |
| Completion re-save encounters frozen answers, confirmed submission or another saved analysis | Stop that completion and offer reload | Preserve the saved envelope; normal restoration recovers its result and original retry answers. Never replace it with the plain RAM result |
| Output loss is confirmed from durable completion or demonstrably abandoned execution, and the server permits recovery | Automatically return to preparation after acknowledged loss recording | Retain the current tab's document draft and original execution facts. Presented initial output awaiting answers remains protected. Never infer again automatically; reconnection rereads eligibility after failure |
| Return to preparation is accepted but local result deletion fails | Explain the accepted transition and offer reload after checking browser storage | Reconcile the committed server state; do not retry loss recovery against the old analysis |
| Failure/cancellation is confirmed | Offer explicit inference retry when its retained prompt is eligible, or **書類の準備へ戻る** | A model retry is a new inference and requires the participant's action. Unknown/accepted completion never authorizes it |
| A pending consent/email preparation expired, or consent/authentication was superseded | Require renewed checks or **同意手続きをやり直す** | Reuse valid fixed preparations for uncertain retries; new consent/identity requires explicit input and confirmation. Confirmed participant authentication has no application deadline; reload alone does not renew consent |
| Survey/consent/withdrawal dispatch has an uncertain outcome | Explicitly retry with the original identity and payload when the operation fence permits it | Frozen answers and sealed preparations survive reload; no regenerated request and no inference from transport failure. See the interrupted-operation limitation below |
| Withdrawal is accepted but cloud cleanup remains pending | Automatically check every 30 seconds on the terminal home screen; explicit retry on the withdrawal form | Keep participation terminal and reuse the original withdrawal. No new email input is required |
| Withdrawal server cleanup is confirmed but browser deletion fails | Stop automatic checks; offer **データ削除の再試行** after checking browser settings | Retry local cleanup in the same session; preserve receipt access and the confirmed server outcome. Reload is a fallback if repeated local retries fail |
| Presented initial output awaiting answers is lost, execution ownership is unverifiable, or participation is withdrawn | Preserve the protected state and direct the participant to a researcher | No automatic reanalysis, reset or new initial participation. The researcher decides recovery using retained study facts |

All withdrawn participation requires administrator recovery and fresh consent/email authentication after cleanup; no automatic or ordinary return to a fresh start remains. Debug-only force reset is a separate explicit action; it revokes captured authority before browser cleanup.

## Web process restart

Restarting Web with the same authority SQLite file and session/sealing key namespace preserves credential validity, business metadata, browser-owned results and fixed retries. Process-local prompts, output and execution ownership disappear. Losing the authority file or changing the key namespace is a different boundary: admission must verify credentials and confirmed invalid-generation recovery still preserves accepted study facts in Support.

| State before restart | Behavior after restart |
| --- | --- |
| Inference was running; no terminal acknowledgement exists | When retained Linux ownership proves execution ended, record unavailable output in Support and return to preparation without changing its unknown outcome or starting inference. Unverifiable ownership remains unconfirmed and uses administrator review |
| Completion is recorded but output was never presented or stored | Confirm RAM output loss, record it in Support, and automatically return to preparation only when eligible. Preserve a document draft in the current tab |
| Failure is confirmed, but the retained prompt is lost | Permit explicit return to preparation; the old prompt retry is unavailable |
| Result is saved and presentation is confirmed | Reuse the browser result for display, Word export and questionnaire navigation. RAM loss does not mean the browser result is missing |
| Survey dispatch failed and released its fence | Restore frozen answers and explicitly resend the identical request |
| Accepted withdrawal cleanup is pending | Keep withdrawal terminal and resume cleanup with the original sealed request |
| Presented initial output is absent from browser storage too | Preserve initial-study protection and direct the participant to a researcher; no automatic replacement analysis |

**Interrupted operations:** ownership records include Linux host boot ID, PID and process start time. A read releases only ownership proven to belong to a terminated/different process, preserving session credentials and the business hash. Survey dispatch resumes with the original frozen payload; it is not labeled failed merely because the process stopped. Live ownership is never cleared based on elapsed time alone. Older locks with no verifiable owner or unavailable ownership checks remain blocked and need administrator recovery. Normal inference is detached and does not hold the business fence throughout execution.

**Administrator fallback:** Admin reviews current state and an optional completed initial target, confirms the destination/reason with Firestore version checks, and records a one-use grant. The participant opens **研究責任者に復旧を依頼した方へ** in the footer, uses **研究責任者の復旧許可を適用**, consents again with the same email and confirms its new link. After authentication, Web opens initial documents, the original initial questionnaire, or follow-up documents. The questionnaire works without a result body and freezes identical retries in a separate owner-bound browser seal; no new inference or historical presentation timestamp is invented. Withdrawal cleanup and current cloud boundaries still gate renewed consent. See [study operations](../../../docs/study-operations.md#administrator-selected-recovery-destinations).

The browser restart scenarios kill and relaunch the actual standalone Web process with unchanged synthetic settings and retained authority, while local Support/model stubs remain running. They verify this Web boundary, not cloud service restart, deployment storage retention or real-model cancellation.

## Reload and participant input

Reload reconciles the screen with server-authorized state. It does not cancel inference, withdraw participation, renew consent or erase study history. It loses in-memory documents, unsent questionnaire drafts and consent-form input. Saved results, frozen submission answers and sealed fixed retries remain available while their session and identities are valid. Confirmed invalid admission can clear them as described above; therefore avoid reload as the first response to a transient failure.

Reload notices explain the input loss and saved-data distinction. `recovery: "reload"` and `ReloadPageButton` mean page reload; they do not invoke the debug reset route. Expired consent and protected study eligibility use their own controls and guidance rather than a generic reload shortcut.

## Implementation ownership

- `src/lib/session-failure.ts` defines rejected session-state reasons shared by cancellation and UI classification. Busy state is excluded.
- `src/features/session/session-recovery.ts` supplies common busy/reload notices. Workflow owners supply payload-specific retries and researcher guidance.
- `useSessionAdmission` distinguishes initial admission retry from invalidation of an admitted screen; only the former can retry admission in place.
- `withSessionRead` validates the selected snapshot before and after a read without acquiring a mutation fence; its context prohibits session save/destroy. View navigation, result export validation and already-recorded presentation use this boundary. First presentation still requires a guarded, acknowledged mutation.
- `useAnalysisJob` owns observation, completion retry and confirmed output-loss recovery. Explicit reconnection clears old observations and rechecks recovery eligibility.
- `WithdrawalCleanupPanel` owns the bounded automatic cleanup checks and explicit local-deletion retry.

Synthetic tests must cover preserved input, identical retries, fresh eligibility checks, and rejection of late writes. Browser scenarios use local participant/model stubs; they do not establish real cloud or model behavior.
