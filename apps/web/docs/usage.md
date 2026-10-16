# Using Web

This guide describes participant-facing behavior and recovery. Start with the [Web README](../README.md) for launch instructions and [Web architecture](architecture.md) for implementation contracts.

[Recovery decisions](recovery.md) explains automatic continuation, operation-specific retries, reload and researcher assistance. Prefer retries that retain input for transient failures; reload reconciles stale screens and discards in-memory drafts.

## Participant flow

Initial participation follows a fixed 8-step flow:

1. 研究の概要 (Research Overview)
2. 研究の説明 (Research Explanation)
3. 研究参加の確認 (Participation Confirmation)
4. メールアドレス認証 (Email Verification)
5. 書類の準備 (Document Preparation)
6. 解析結果の確認 (Analysis Results)
7. アンケート回答 (Post-analysis Survey)
8. 完了 (Completion)

Steps 1–3 allow forward/back navigation without changing shared business state. The current tab retains its email/check draft during these moves; a reload discards that unsent draft. Before sending, changing a valid email prepares a new identity and invalidates older tab actions. During authentication, **メールアドレスを訂正する** immediately returns to consent with empty input/checks. Mail dispatch, including to a corrected address, retains a server-enforced 60-second interval. Previously sent mail and accepted events remain; correction is unavailable after authentication/analysis.

After the initial survey, subsequent analyses use the follow-up questionnaire; participants can also return directly to document preparation from a follow-up result. If completed initial or follow-up output is lost before presentation, the server confirms that loss with Support and automatically returns to preparation, preserving earlier attempt and timing records. The first presented result remains paired with the initial questionnaire; another analysis cannot start before those answers are accepted. The current tab retains its draft, but a reload has lost it; enter documents again when needed. Analysis never restarts automatically. Results are displayed only after confirmed Firestore presentation recording; a delayed RAM-cleanup acknowledgement does not delay display.
Withdrawal is shown as a terminal completion page outside this 8-step progress flow.

During initial participation, the current step and step count remain visible at every screen width. “全ステップを表示” expands the complete step list on phones and desktops; collapsing it leaves more space for the current task. Follow-up participation shows repeat-analysis guidance instead of the step list or an all-complete indicator. On phones, document and survey controls share the outer card's inset rather than adding another padded card.

Likert survey responses can be returned to unanswered using “選択を解除（未回答に戻す）”; required items must still be answered before submission. Single-choice dropdowns return to unanswered with “選択してください” and have no separate clear button. Clearing a choice changes only that answer, without submitting it. Answer controls, including clearing, are disabled during restoration/submission and frozen retries. Choices come from the questionnaire JSON. Document-format conversion must stay on the local device without cloud upload or synchronization.

Question labels show “必須” or “任意” from the questionnaire's existing required flag. Follow-up participation remains optional, but submitting it requires answers to its required items. Likert choices use one column on phones, two from 640px to 1023px, and seven from 1024px, preserving their questionnaire order.

The result, questionnaire and completion screens use **ブラウザー内の一時データを消去する**
for explicit cleanup of local documents, results and answers, including recovered
answers retained after a failed cleanup. Original files, downloaded files and
submitted questionnaire records remain outside this cleanup.

## Consent history and related documents

The footer links to **同意履歴・関連書類** (`/download`). With an existing
authenticated, follow-up or withdrawn session, the page shows **今回の同意・撤回**
first: the consent selected by that session, its confirmation time in Japan time,
and its linked withdrawal receipt when present. It does not select the most recent
consent from another browser. Other consent periods appear newest-event-first in
collapsed **これまでの同意・撤回** entries, pairing each consent with its own
withdrawal. The current record is not repeated in older history; the older-history
section is omitted when empty.

Each record offers its exact consent/withdrawal copy and the explanation and plan
from that event's document set. Withdrawal-related explanation and plan files are
under **撤回時の関連書類**. A withdrawal receipt confirms acceptance, independently
of data cleanup; the current receipt links to `/withdraw` while cleanup remains
unconfirmed or incomplete. Historical withdrawals do not offer cleanup actions
for a different consent period.

**現在公開中の書類** separately offers the bundled explanation and plan, with the
human document-set version. Set SHA-256 determines whether an event's set matches
the current set, even if human version labels are identical. A different set is
an informational notice with a link to current documents; it does not establish
which individual document changed or request renewed consent. See
[document sets](../../../docs/document-sets.md).

Before consent, current public documents appear first. Explanation downloads
remain public; plan downloads require consent and email authentication. A pending
email session is labelled **メール認証待ち** and has no accepted receipt. An
unauthenticated browser cannot determine whether earlier records exist and offers
the configured researcher contact for reissue, without a download-only
authentication flow. Reception closure retains the existing closed-screen gate.

History loading, read failure, stale-session reload and inaccessible history are
distinct states. Failed initial session admission offers **セッションの確認を再試行**
without reloading or discarding browser data. An invalidated session instead offers
**ページを再読み込み**, with the input-loss notice, and never stays labelled as loading.
Incomplete upstream history and ambiguous or unmatched event
associations fail the history read rather than inventing a relationship. PDF preparation and failures
appear beside the selected file; retry repeats only the read/download. Missing
archived originals never fall back to current templates. Late responses cannot
replace another screen's notices or restore a replaced session's history.

## File import

DOCX and PPTX conversion runs in a dedicated browser Worker. Document bytes and extracted text remain on the local device; import does not call Support or an LLM. “読み込みを中止” stops an active import, and leaving the document screen also terminates it. A cancelled, failed or late import cannot overwrite the current draft.

Office files are read by seeking to the ZIP directory and selected XML parts. Images, videos, embedded objects and unrelated XML are not loaded or expanded for text extraction. DOCX conversion receives a new archive containing only validated text-related XML and its relationships, including renamed parts and standard fallback paths. Text import does not perform OCR. A large image therefore does not consume the XML expansion allowance.

The [import policy](../src/features/document/document-import-constraints.ts) uses separate limits for file containers, parsing and text:

| Input or work | Limit |
| --- | --- |
| DOCX/PPTX container | No fixed file-size cutoff; bounded range reads instead of a whole-file buffer |
| Text/Markdown file | 1 MB (1,000,000 bytes), checked before reading |
| Actual Office reads | 128 MiB across directory, headers and selected compressed data |
| ZIP directory | 8 MiB per metadata read and at most 10,000 entries |
| Selected XML | 8 MiB expanded per part, 16 MiB compressed per part and 64 MiB expanded across the import |
| XML structure | Depth 64 and 300,000 nodes per part; no DTD/entity declarations |
| PPTX slide list | 1,000 references; repeated resolved slide parts are rejected |
| Extracted draft | 128,000 UTF-16 code units, without truncation |
| Office import duration | 60 seconds, with manual cancellation available throughout |

Range reads accommodate media-heavy research files without allocating gigabytes in browser memory. There is no reason to reject an Office container solely because it holds large images or videos; the limits apply to metadata and the parts actually consumed. XML limits leave space for per-character formatting, styles and slide markup around the 30,000-grapheme analysis budget. Drafts above that analysis budget remain editable after import; analysis requires the combined document names and bodies to fit within 30,000 graphemes. This differs from UTF-16 code units for some characters, including emoji and combining sequences.

These are resource ceilings, not a guarantee that every Office file is readable. Corrupt, encrypted, ambiguous or unusually complex files can be rejected. If a file cannot be imported, save its text locally as Text/Markdown or paste the text into the editor, then shorten the draft to the analysis budget. The error message points to this recovery path. Avoid cloud upload or synchronization when converting research documents.

## Debug Routes

- `/debug`, `/debug/home-flow`, and `/debug/alert-message` provide development-only runtime and UI inspection views.
- Debug routes are intended for development and troubleshooting only.
- When `NODE_ENV=production`, these routes always return `404`.
- Outside production, debug routes are enabled by default. `DEBUG_PAGES_ENABLED=false` disables them; `true` enables them. Whenever debug routes are enabled, the footer also exposes development shortcuts to `/debug`, `/debug/home-flow`, `/debug/alert-message`, and `/reset`.
- Contributor-facing debug route details and implementation rules are documented in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Reset Route

- `/reset` is available only when debug pages are enabled outside production. It restores this site's application data to first-visit browser state for debugging, regardless of active work. Its explicit button revokes captured sessions and deletes accessible origin cookies, all localStorage and current-tab sessionStorage entries, every IndexedDB database (including session coordination), Cache Storage, Service Worker registrations and origin-private files where supported. It reloads the start screen with fresh browser state and requires consent/email authentication again. Browser history, permissions, HTTP cache and other sites remain outside its scope.
- Interrupting running analysis, authentication or questionnaire work and losing browser documents, results or pending answers are accepted consequences. Cleanup does not coordinate with other running tabs or workers; a delayed reset can delete data saved by a newer session, and surviving pages can recreate stores or block deletion. Close other tabs for this site and wait for reset completion before starting fresh work. See the [reset contract](session.md#retries-and-generation-recovery).
- Local reset requires fresh consent and email authentication. It does not query Support history, transfer old identity/content or erase accepted Firestore facts and study eligibility. After the reception cutoff, the server cleanup action can still revoke the captured generation without renewing authentication; the browser displays the reception-closed screen.
- Reset waits for session revocation before browser cleanup. A later cookie or storage failure does not roll revocation back, and cleanup may be partial or remain pending. Close other tabs and retry (reload if needed), or delete this site's data through browser settings. Already dispatched survey or withdrawal requests may still be accepted; browser reset does not undo their server-side effects.

Withdrawal remains terminal and requires administrator recovery before resumed participation; see [cleanup confirmation and restart](participation.md#cleanup-confirmation-and-restart).

## Data and Security Behavior

- Each SessionID authenticates with one immutable HttpOnly random credential cookie. Private SQLite stores allowlisted identity/authentication/processing metadata, its consistency hash and a credential digest. Neither plaintext nor encrypted email is saved in this server database: email and fixed retry context stay sealed in browser IndexedDB. Ordinary operations do not rewrite the cookie; revision fences prevent late context responses from overwriting newer data. Documents/results remain out of persistent server storage; prompts and completed output may be held temporarily in local server RAM for retry/retransmission.
- Tabs share SessionID and saved results without primary ownership, competition checks or awake signals. Screens/drafts need not synchronize. Actions validate current hash/result IDs and prompt reload if stale; result/survey navigation shares a hash. Every tab can reload and reconnect to the same analysis. Waiting shows a spinner and approximate elapsed time; generated-token progress is unavailable. The display starts from server elapsed time and counts up one second per tick, without corrections from status polling or catch-up jumps after browser delays. Reload restores server elapsed time. Recorded analysis durations use separate server measurements.
- Original answers are validated and sealed in the browser result before submission for identical uncertain retries. Complete one-shot inference, browser result storage and acknowledged Firestore presentation recording precede display. Pending output remains hidden and can be retrieved from server RAM for up to ten minutes. Browser storage/presentation acknowledgement releases it. Prompts survive confirmed failure for explicit **解析を再試行** within that deadline. **接続を再確認** and completion retries never repeat inference.
- IndexedDB holds session/reset identifiers, context revisions, and sealed private context/results/retry answers in one transaction boundary; it contains no plaintext document or result. If browser coordination storage is unavailable, show recovery instead of admitting a competing session. localStorage holds only discardable dismissed information-message IDs. Initial/follow-up eligibility comes from Support participation state, independently of browser counts or stored output. Survey submission retains the result. The explicit document/result deletion button clears it and returns to document preparation; confirmed withdrawal and explicit reset also clear browser data. Invalid stored results are discarded.
- Documents and prompts are sent only to local LM Studio. AERPP does not persist document bodies or analysis output on its application server. LM Studio logging and retention remain under the operator's control.
- Leaving or reloading the result screen preserves analysis. Returning observes the same attempt. Explicit **解析を中止する**, withdrawal and reset revoke it. Server restart or retention expiry loses unacknowledged content; unverifiable execution ownership or lost presented initial results awaiting their questionnaire require researcher review. Completed or demonstrably abandoned execution permits return to preparation after confirmed loss recording, subject to the initial-questionnaire boundary. Failed, incomplete, interrupted, and empty responses do not become completed results.
- Before model execution, the participant API records a start with per-document body grapheme counts, timing, questionnaire kind and consent/owner IDs. Observed completion/failure/cancellation is recorded separately; missing terminal evidence remains unconfirmed. These records never contain document names, bodies or model output. They do not count as questionnaire completion.
- Withdrawal requires completed email authentication and a matching confirmed consent. Pending-email sessions cannot withdraw; terminal sessions can retry already-authorized cleanup.
- Consent preparation saves its fixed sealed request in sealed browser IndexedDB before mail. Retries preserve identity, ciphertext, withdrawal boundary and deadline; expired/superseded preparation requires fresh checks. Recipient cooldown/hourly limits and normal email confirmation remain in force.
- Explicit renewed consent requires a new email confirmation after withdrawal cleanup. The new consent record ID distinguishes participation before and after withdrawal; old requests cannot change the renewed participation.
- External auth, consent, survey, and information services receive the identifiers and data needed for their operation, including analysis metadata and submitted survey answers. Those services control their own persistence, retention, and access permissions.
- Resuming participation after withdrawal requires administrator review and a one-time recovery grant, regardless of prior completion. Withdrawal itself requires confirmed consent and matching participant ownership, without a recovery grant. The terminal screen provides the configured contact and retained document-download access. Admin selects initial documents, an available original initial questionnaire, or follow-up documents with reason, actor and time; fresh consent/email confirmation consumes the grant. Deleted research content is never reconstructed.
- Withdrawal ends participation even when server-side deletion is still in progress. `/withdraw` allows deletion retries from the withdrawn state. The deployed scheduled worker also resumes committed cleanup after browser/session loss or reset; its 30-minute interval is not a completion guarantee. The withdrawal PDF is an acceptance receipt and does not require deletion completion. Background completion does not update the current session’s deletion confirmation; a retry is still required before displaying completion. Debug reset clears local state but does not undo upstream withdrawal. See [Reset Route](#reset-route) and [Support cleanup](../../support/docs/persistence.md#participation-and-withdrawal).
- Server logs use structured JSON with request IDs for correlation. Participant content, email values, cookies, credentials, and survey free text are excluded. Development snapshots omit participant identifiers and email values.

Old browser state cannot restore authentication without current server authority and its opaque credential. No old-data reconstruction is implemented; preserve the current coordination volume and keys as described in [session contracts](session.md#local-authority-resource-limits). Loss of a presented initial result requires researcher review; confirmed loss before presentation follows the preparation recovery described above.

See [architecture](architecture.md#data-flow-and-persistence) for session fields, identifier derivation, API contracts, result persistence, and logging design.

## Document input limits

- PPTX import follows the presentation order and reads text independently of XML namespace prefixes. It joins formatting runs without adding spaces inside words or numbers and preserves paragraphs and explicit line breaks. Malformed slide XML or unresolved slide references reject the import so partial content is not treated as a complete document.

- All document tabs have equal status; add documents in any order and edit their names. Successful imports populate the name from the filename. Any tab can be removed when more than one document remains.
- Clearing a nonempty document body or removing its tab requires confirmation. Canceling preserves its body, name and imported filename. Empty bodies need no confirmation; these operations do not create an undo copy or persist document content.
- Non-empty documents require a name. Names are limited to 200 code units; at most 20 documents and a combined 30,000 graphemes of names and text are accepted.
- Generated Markdown images are converted to alt text before display or Word export, preventing automatic image requests while preserving text, tables, and ordinary links.

## Reception closure

At `support.access.expiresAt`, Web replaces every participation stage/step and route (including `/reset`) with a dedicated **受付は終了しました** screen. It displays the contact address from `config.json` `support.contactEmail` for inquiries and withdrawal requests. It does not transition to `start`, withdraw participation, delete browser storage or erase registered data. An open page uses a server-synchronized countdown and rechecks on focus/visibility; browser suspension can delay rendering until the page resumes. Active work is cancelled locally; guarded business saves, participant API dispatch and LLM jobs reject further study work. Session reads and retained authentication remain valid. A previously accepted Support write can still finish; closure does not roll it back. Update Web, Support and the Admin deadline display from the same reviewed profile; see [reception maintenance](../../../docs/study-operations.md#reception-changes-during-maintenance).

Ordinary environments do not provide `/reset`; the [debug reset](#reset-route) has its own explicit control. Confirmed invalid sessions recover automatically. Valid stale screens retain data and require reload; transport failures offer the operation-specific retry described in [recovery decisions](recovery.md).
