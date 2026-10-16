# Shared browser sessions

Every tab in the same browser uses the same SessionID. There is no primary ownership, heartbeat or takeover delay. [Architecture](architecture.md) owns the implementation map and [session contracts](session.md) own cookies and authority.

## Session boundaries

`src/features/session/` owns admission and operation validation. `useSessionAdmission` reports `checking`, `ready` or `unavailable`; it grants no tab role. Initial admission failure permits explicit in-place retry; invalidation of an admitted screen requires reload. Admission takes the shared generation ID and verifies its credential on the server. `POST /api/session-status` checks the current session only when retrying local result cleanup; it is not polled for tab liveness. [Recovery decisions](recovery.md) owns the retry/reload criteria.

Keep synchronization limited to consistency boundaries: the initial admission Web Lock shares the first credential cookie, short IndexedDB transactions atomically protect browser generations, private context, result/retry payloads and reset, and server operation fences reject conflicting mutations. None reserves a tab or remains held while the user views a screen or inference runs. Tab-local tokens and cancellation helpers retain each screen's hash and reject delayed responses after session replacement.

## Result and questionnaire navigation

The questionnaire opens in the current tab; **結果表示に戻る** retains that tab's in-memory answers. A new tab displays the stored result, and can open its own questionnaire view. Result and survey navigation share the same state hash and use a validated read-only snapshot without competing for a mutation fence. Confirmed browser results remain usable after Web process restart even when RAM output is gone. Unsent drafts need not synchronize or survive reload; frozen submission retries preserve their original encrypted payload.

Other tabs keep their existing screens after a mutation. Each action checks the screen's state hash and relevant result identity against the server. A stale action shows reload guidance. Deleting a follow-up result returns the deleting tab to document preparation, while another tab may still show the old result until it acts or reloads. This does not invalidate the underlying browser session.

## Ownership and recovery

Before inference, the server commits one active analysis for the browser session and Support atomically claims the initial study attempt. Other tabs show analyzing and cannot start another analysis. Reload in every tab resumes observation of the same analysis. Read-only analysis status polling does not compete for tab ownership. There are no focus, visibility or status requests for tab competition. A local server watcher propagates authority revocation across workers.

Initial analysis start reserves its browser owner; confirmed failure/cancellation before presentation releases it. From initial presentation through initial questionnaire acceptance, another browser is refused. Successful initial acceptance releases this restriction and permits independent follow-up analyses in separate browser sessions. Cloud state, not browser storage or an absent result, determines eligibility.

Missing/invalid authority or an unverifiable credential triggers fresh unauthenticated admission after revocation and local cleanup. Transport failure and pending first admission retain data. Reuse a fresh session already created in the browser. Losing a presented initial result awaiting answers requires researcher review. Eligible output-loss recovery follows [recovery decisions](recovery.md); there is no automatic reanalysis.

## Response continuation scope

| Boundary | Policy |
| --- | --- |
| Ordinary mutations and result actions | Require current hash, consent and relevant analysis identity; reject stale screens with reload guidance |
| Inference and pending completion | Continue across reload/navigation; abort on authority revocation; ignore stale completion and protect replacement browser data |
| Result/survey navigation | Validate current state without a save or hash change |
| Withdrawal | Validate current email/consent, then prioritize and preserve original retries |
| Debug reset | Revoke captured sessions regardless of busy state, then clear origin storage/cookies |

Credential cookies are immutable per generation and ordinary operations never rewrite them. Sealed private context carries a monotonic revision to prevent late responses from overwriting newer browser context. Browser generation checks also fence response handling and storage writes before delayed storage notifications arrive. Cancellation never rolls back accepted cloud effects; unknown survey outcomes retain identical retries.

## Withdrawal

Withdrawal is available after authentication in any tab, including during analysis. The entered email must match the current protected session before any priority fence. It commits terminal state first and distinguishes acceptance from deletion completion. Support can finish committed cleanup without the browser.

Only the terminal home screen checks incomplete cleanup again 30 seconds after each response; this is unrelated to tab liveness. The withdrawal form uses explicit retry. All withdrawal remains terminal and requires administrator recovery plus fresh consent/email confirmation before resumption. The contact and document-download link remain available across cleanup confirmation and reload.

## Force reset

`/reset` uses the same non-production guard as the debug menu. Ordinary participants have no reset route or reset recovery link. Its purpose is to restore first-visit browser state for debugging, even when other processing is active. The explicit button revokes captured sessions and clears this site's application storage, including the coordination database itself, before reloading. Interruption of running work and loss of browser documents, results and pending answers are accepted effects. Cleanup is non-atomic: delayed cleanup can delete a newer session's data, and other pages or workers can recreate stores or block deletion. Close other tabs and wait for completion before starting fresh work. Already dispatched survey/withdrawal requests may still commit; accepted Firestore records and study eligibility remain intact. See the [reset contract](session.md#retries-and-generation-recovery) for the exact storage scope and failure handling.
