# Web browser, screenshot and PDF checks

Source and output paths are relative to `apps/web`; run commands from the workspace root, preferring the maintained root entrypoints. Install prerequisites through [workspace development](../../../docs/development.md#prerequisites).

## Unit and component tests

Run `pnpm run test:web`, or append a file such as `src/lib/session.test.ts` for a focused suite. `pnpm run check:web` also runs lint, import-boundary checks and route type generation/TypeScript. Vitest cases stay beside their source; `tests/` holds package-wide/cross-package contracts and `test-support/` holds shared synthetic fixtures. See [test maintenance](../../../docs/coding-conventions.md#tests) before moving or deleting cases.

Unit tests use synthetic runtime settings and public assets without private profiles, cloud credentials or a running model. IndexedDB unit tests use `fake-indexeddb` to exercise concurrent compare-and-replace, ABA changes, fresh-state retry and unsupported-schema rejection, request-success followed by transaction abort, and atomic reset/cleanup. Component tests wait for asynchronous storage completion. Cookie/SQLite authority and browser-storage cases complement the browser suites below; mocks alone do not establish browser or external-service behavior.

## Browser E2E Tests

Playwright complements Vitest with Chromium tests of the running application. Use Node 24 and install the locked dependencies first:

```sh
pnpm install --frozen-lockfile
pnpm run test:e2e:install
pnpm run test:e2e:web
```

The devcontainer post-create script already performs dependency and browser installation. On other Linux hosts missing browser system libraries, run `pnpm run test:e2e:install --with-deps` using the host's normal package-install permissions (the [Playwright browser installation workflow](https://playwright.dev/docs/browsers#install-system-dependencies)). E2E tests use Playwright's versioned browser; installing Debian's `chromium` alone does not prepare them. If the default browser cache is read-only, set `PLAYWRIGHT_BROWSERS_PATH` to the same writable directory for both installation and test execution. A read-only npm cache can likewise be redirected with `npm_config_cache`.

`test:e2e` creates an isolated application copy under `.playwright/`, builds it with the repository's Next.js configuration and Turbopack, and starts it on `127.0.0.1:4310`. The copied config sets Turbopack's root to this repository so the copy can share installed dependencies. A contract-validating participant API and synthetic one-shot LLM response run on `127.0.0.1:4311`. Both ports must be free; the runner never reuses an existing server. Run only one Web E2E command at a time. The separate `pnpm --filter @aerpp/web run test:e2e:debug` suite stages the same public inputs and synthetic settings under a development server with debug pages enabled, exercising force reset and delayed-response fences. Reset checks also seed an extra coordination record and origin-private files to verify complete database/file deletion rather than only participant-slot cleanup. Production browser tests verify that `/reset` is unavailable.

The shared Web configuration disables Next.js response compression because the deployed [Caddy proxy](../../../infra/Caddyfile) owns gzip/zstd encoding. This also avoids the bundled compression middleware's [drain-listener leak](https://github.com/expressjs/compression/issues/152). Direct local Next.js responses, including browser-test responses, are uncompressed; these scenarios do not verify Caddy encoding.

Debug reset's delayed-response checks cover stale ordinary responses and reset attempts superseded before origin cleanup starts. They do not guarantee preservation of concurrent work once whole-origin deletion has started: interrupting other processing and deleting newer browser data are accepted debug-reset effects. See the [reset contract](session.md#retries-and-generation-recovery).

A blocked-deletion scenario keeps a real connection to the coordination database open and requires the error notice and retry button to appear before that connection closes. After closing it, retry must finish cleanup and return to fresh admission. Unit tests separately preserve cancellation of an unfinished reset transaction.

Build failures report the exit code and termination signal. Unexpected application exits also fail the runner in debug mode; an explicitly requested shutdown remains a clean stop. Use `DEBUG=pw:webserver pnpm run test:e2e:web` to include build stdout in the diagnostic output. A `SIGKILL` without a compiler error warrants checking host memory and OOM-kill records. On memory-constrained Linux hosts, reducing CPU parallelism can help: inspect the allowed CPUs with `taskset -pc $$`, then run, for example, `taskset -c 0,1 pnpm --filter @aerpp/web run test:e2e` if CPUs 0 and 1 are allowed. This limits only that command and its children; record the CPU restriction with the test result.

The runner copies application inputs, including only the required public `assets-public/` materials, and passes an explicit synthetic environment to the build and application. It excludes `.env` files and unrelated working documents. It changes only the LLM transport URL in the temporary copy; the source model selection, generation settings, and prompts remain unchanged. Authentication succeeds through the local stub without sending email; the stub validates a scoped synthetic Bearer credential. Browser requests outside the local application are blocked and fail the test. Stub contract violations and uncaught page errors also fail tests. Pair these checks with Support emulator tests; neither establishes real mail or model inference.

Choose scenarios by the boundary being changed:

| Boundary | Scenario owner |
| --- | --- |
| Consent, authentication, initial/follow-up flow, survey retries and Word export | [Participation](../e2e/participation.spec.ts) |
| Cookie/context protection, email correction and stale preparations | [Session storage](../e2e/session-storage.spec.ts) |
| Concurrent survey freezes, completion fallback overlapping a frozen questionnaire, and identical retry after reload | [Browser transactions](../e2e/browser-transactions.spec.ts), [completion retry](../e2e/completion-survey-retry.spec.ts) |
| Shared-tab admission, result navigation and stale action rejection | [Browser coordination](../e2e/session-coordination.spec.ts) |
| Detached inference, steady elapsed display despite status timing corrections, clock-independent elapsed time across reload, escaped result whitespace, retained-prompt retry, cancellation with delayed admission/acknowledgement or concurrent completion, failed terminal-record retry across reload without inference, presentation and RAM acknowledgement | [Analysis jobs](../e2e/analysis-job.spec.ts) |
| Storage/transport faults, withdrawal cleanup while PDF delivery stalls, analysis during a pending consent download, receipt access after reload and cleanup confirmation, and late responses | [Recovery](../e2e/recovery.spec.ts) |
| Public/pending access, paired document history before/after withdrawal, exact older-record selection, set identity notices, admission retry without reload or data loss, history outage/retry, mobile/dark layout and continued access after rejecting an outdated withdrawal set | [Document history](../e2e/document-history.spec.ts) |
| Actual Web process restart with retained synthetic keys/SQLite | [Server restart](../e2e/server-restart.spec.ts) |
| Reviewed recovery, automatic recovery guidance, reset-response loss, consumed-consent preservation, confirmed recovery after mail-response loss/reload for all three destinations, and result-free initial questionnaire retries; accepted submission followed by a browser cleanup abort, retained-answer detection after reload, and subsequent questionnaire editing | [Administrator recovery](../e2e/admin-recovery.spec.ts), [Recovered-survey cleanup](../e2e/recovered-survey-cleanup.spec.ts) |
| Reception cutoff and debug-only force reset | [Reception](../e2e/reception.spec.ts), [debug session](../e2e/debug-session.spec.ts) (separate debug suite) |
| Local file import, cancellation and device layout | [Document import](../e2e/document-import.spec.ts), [UI layout](../e2e/ui-layout.spec.ts) |

Fixtures and server lifecycle code live in `test-support/e2e/`. Tests run serially because the stub has one active scenario; each test receives a fresh browser context. Held responses and browser storage faults provide deterministic failure cases. Restart scenarios keep Support/model stubs running and verify the Web process boundary; they do not verify deployment volume retention or real-model cancellation. [Desktop capture](#desktop-screenshots) uses its own scenario and is excluded from ordinary E2E.

The synthetic Support stub accepts the strict audit-only outcome schema separately
from research attempts. Redelivery may occur after a scenario reset because the
local audit queue survives server restart; these requests must not count as new
research attempts or recreate scenario research. Real owner/consent/start guards
are verified in Support unit and Firestore Emulator checks.

Session-token assertions use a fetch observer injected only into synthetic browser contexts. It captures response headers and action-result chunks without waiting for the entire development response stream to close, retains only the token and a bounded parsing tail, and leaves the original response available to the application. Assertions compare the captured token with the browser's current generation on each poll so reset or delayed admission cannot leave the test waiting against an obsolete snapshot.

```sh
pnpm run test:e2e:web --grep "survey retry"
pnpm run test:e2e:web --headed
pnpm --filter @aerpp/web run test:e2e:report
```

The runner stops its processes and removes the temporary application on completion or normal interruption. Failure traces and screenshots remain in `test-results/`; the HTML report is in `playwright-report/`. These outputs and the staging directory are ignored by Git and Docker. Use only synthetic inputs: traces and screenshots can contain displayed data. After a force-kill, stop any remaining test processes before removing `.playwright/`.

Use `pnpm run check:web` for focused contributor checks and `pnpm run test:e2e:web` when changing these fixtures or browser-facing participation, navigation, storage or recovery flows. These supplement the [workspace PR/release gates](../../../CONTRIBUTING.md#before-opening-a-pr). The E2E build uses synthetic settings and does not validate deployment configuration. Chromium automation and DOCX payload inspection do not establish Safari/Firefox, desktop Word rendering, accessibility or physical-device acceptance. Record local verification in the handoff.

### Desktop screenshots

Run `pnpm --filter @aerpp/web run screenshots` to capture the normal participation flow with `assets-public/`. It uses the same Chromium installation and free ports (4310/4311) as E2E; do not run both commands simultaneously. No application env files or real participant/model services are used.

The dedicated capture configuration builds an isolated application using the eight required `assets-public/` MDX/PDF files, even when private `assets/` exists in the checkout. Questionnaires come from `config/common/survey/`. Source assets remain unchanged. Normal `pnpm --filter @aerpp/web run test:e2e` does not run the capture scenario.

The command saves 15 full-page PNGs at a 1440 × 900 desktop viewport, light color scheme, Japanese locale and Japan timezone: introduction, explanation, consent, authentication instructions, document preparation, analysis in progress, initial result, initial survey, completion, follow-up result, follow-up survey, downloads while participating, withdrawal, withdrawal completion, and downloads after withdrawal. Follow-up screens are reached by submitting the initial survey and analyzing again through normal UI actions. Both surveys use the shared questionnaire definitions. Authentication, survey answers, input documents and model output are synthetic; no email is sent. Error states, mobile/dark layouts, debug/license/reset pages, external authentication pages and PDF page images are outside this capture scope.

Each run creates `.playwright/screenshots/<timestamp>-<unique-id>/` containing PNGs, a local `index.html`, `manifest.json` with screen names and browser settings, and `assets.json` with hashes of the shared research assets. Open the printed index path in a browser to review the images. Only a zero exit status indicates a complete successful run; failed runs retain partial output for diagnosis. Traces are disabled. These generated files are excluded from Git and Docker with the existing `.playwright/` rule. Capture dates and the installed Chromium/font versions can affect pixels, so this is a repeatable capture command, not a pixel-regression baseline.

Screenshots use the locally installed `Noto Sans CJK JP` for Japanese text (`fonts-noto-cjk`, installed by the devcontainer setup). This font override applies only during capture; the application's normal font settings are unchanged.

The temporary application and local services are removed/stopped when the command completes or is normally interrupted. Saved screenshots remain until explicitly deleted. To change viewport or appearance, edit `playwright.screenshots.config.ts`; to change the screen sequence or capture-only font override, edit `e2e/screenshots.spec.ts`.

### PDF form test

Run `pnpm --filter @aerpp/web run test:pdf` with Node 24 to fill the `email` and `date` fields in the selected `assets/consent.pdf` and `withdrawal.pdf` (or `assets-public/` when no private set exists). The DID is drawn directly in the final-page footer, independently of form fields. This tests PDF output directly, not browser form entry. It uses the same PDF filling, Japanese font embedding, footer drawing, and flattening helper as the application. The helper embeds Noto Sans JP Regular once for the filled fields using LibPDF's default full-font embedding; fonts already present in the template remain unchanged. Full-font embedding increases generated files to roughly 3 MB with the current font and templates. Both shared PDFs and `packages/documents/fonts/NotoSansJP-Regular.ttf` at the workspace root are required; missing, empty, malformed, or incompatible templates fail with no substitute templates. Source assets are read only.

Inputs are fixed synthetic values: `pdf-test@example.com`, `2026年9月16日`, and distinct test document IDs. No `.env` file, server, browser, authentication record, or network service is used. This command does not verify authentication, consent record selection, real identifier derivation, or browser downloads.

Each successful run saves `AERPP-consent-TEST.pdf`, `AERPP-withdrawal-TEST.pdf`, and `manifest.json` under a new `generated/pdf/run-*/` directory, ignored by Git and Docker. The manifest records synthetic field values, input/output SHA-256 hashes, and page counts. The command reloads each generated PDF and checks preserved page counts and removal of editable fields. Open the PDFs to check Japanese text, positioning, and clipping visually; these structural checks do not establish visual correctness. Generated outputs remain local and excluded from Git. Previous runs are retained. Use `pnpm --filter @aerpp/web run test:pdf --help` for usage.

Participant form filling uses the pinned `@libpdf/core` dependency; `pdf-lib` reloads the result independently. Keep the default full-font embedding rather than overriding LibPDF's form-font subsetting policy. The [version-specific pnpm patch](../../../patches/README.md) preserves Japanese Unicode mappings for copying/searching and avoids parsing unused template fallback fonts. On dependency upgrades, verify shared font embedding, Japanese text, existing template content and field positioning. Keep the upstream FontBox Apache-2.0 supplement synchronized with the installed version through the root license workflow.
