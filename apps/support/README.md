# Support application

This Node.js service implements the participant API, public support pages, explicit email confirmation, Gmail sender and authenticated maintenance routes. Admission and maintenance are explicit deployment controls. Web deployment and real-mail acceptance are separate gates. Follow the [deployment procedure](../../docs/deployment.md) before cloud activation.

## Runtime and routing

`@aerpp/config/support-routes` fixes relative paths. One service base URL builds the participant, operator and confirmation-page URLs; no per-operation endpoint discovery is needed. The canonical request schemas live in `packages/contracts/src/request-schemas.ts` and are exported through `@aerpp/participant-api-contracts`; root `contracts:sync` updates generated copies.

`src/app.ts` composes middleware, explicit routes and error handling. `src/maintenance-handler.ts` owns Scheduler authorization, maintenance-window checks and cleanup/mail-health dispatch within the same request-scoped database context.

The server requires a generated/injected `SUPPORT_RUNTIME_JSON`, validated by `@aerpp/config/support`; it never reads local configuration files or cloud secrets during requests. The shared manual-configuration projection is implemented through `@aerpp/config/support-profile`; selected cloud deployment injects a pinned SUPPORT_RUNTIME_JSON secret version through Terraform. `env:check` and `env:generate` accept selected `support`. See [editable configuration fields](../../docs/configuration.md#support-editable-configuration). Do not hand-author a second editable configuration file or put actual runtime JSON into public examples. The standalone server defaults to port 8080, binds loopback locally and binds all interfaces in cloud deployments. Test and production require independent settings.

| Setting | Meaning |
| --- | --- |
| `environment`, `projectId`, `baseUrl` | Explicit `local` with demo Firestore/loopback, or `test`/`production` with HTTPS and ADC |
| `credentials` | Verifier registry: credential `id`, SHA-256 `verifierHash`, `serverId`, environment, allowed operation names, `notBeforeMs`, `expiresAtMs`, `revoked` |
| `admissionOpen`, `maintenanceEnabled` | Explicit switches for new mail/confirmation and maintenance dispatch |
| `tokenKey` | Stable, separately provisioned email-token derivation key; 43–128 base64url characters; never reuse a caller/Gmail credential |
| `schedulerIdentity`, `contactEmail` | Exact permitted Scheduler identity and public contact address |
| `mailMode`, `gmail` | Local synthetic sink, or selected Gmail settings: client ID/secret, refresh token, sender and participantEmailPattern derived from web.nextPublicParticipantEmailPattern |

Protected caller routes require `Authorization: Bearer <id>.<secret>`; secrets must be independently provisioned high-entropy values (43–128 base64url characters). The server keeps only their SHA-256 verifier in its registry, checks environment/validity/revocation/operation and binds submitted `serverId` to the caller. Multiple explicit registry entries permit bounded overlap during rotation; remove/revoke old entries and update every serving revision. Caller permission does not replace participant ownership/consent checks. Withdrawal remains pseudonym-wide.

The maintained private-configuration projection supplies one Web caller from `SUPPORT_WEB_API_CREDENTIAL`; it exposes no editable multi-caller registry or automatic rotation workflow. Do not hand-edit generated runtime JSON to stage overlapping credentials. A change to that provisioning workflow requires implementation and acceptance work.

Unknown routes return 404. Maintenance POST routes are `/maintenance/withdrawal-cleanup` and `/maintenance/mail-health`. Each verifies Google signatures, issuer, expiry, the exact full-route audience and allowed service-account email with `email_verified`. Public Cloud Run invocation does not authorize these routes. Keep maintenance disabled until the selected runtime and data access are verified.

Withdrawal cleanup shares a 40-second work budget across the entire scheduled sweep, including discovery and all candidates. It preserves deletion progress and its fair cursor for the next invocation. See [cleanup deadlines and persistence](docs/persistence.md#participation-and-withdrawal) for transaction retries and in-flight RPC limits.

If any candidate fails, the maintenance endpoint returns HTTP 503 with `WITHDRAWAL_CLEANUP_FAILED` so Scheduler can use its bounded retry policy. Successful batches remain committed and retries resume pending work. Size-related failures shrink the actual attempted batch, including a previously persisted smaller limit; a failing single-document batch remains pending for operator recovery.

Withdrawal cleanup is scheduled every 30 minutes and Gmail health every six hours. Both run only from twelve hours before `support.access.notBefore` until the independent `support.access.backendStopsAt` (end exclusive). The window derives from unrevoked credentials in the selected environment and does not extend participant API authorization. Outside the window, verified Scheduler calls return a successful `MAINTENANCE_OUTSIDE_WINDOW` skip before Firestore or Gmail access. Scheduler dispatches continue, but maintenance work does not run. After the backend stop, unfinished cleanup remains durable for explicitly arranged recovery; it is not erased or reported complete. Inspect aggregate cleanup results before the backend stop and arrange operator recovery for failures.

## Public pages

The public `/robots.txt` route disallows crawling all paths for every user agent, matching Web and Admin.

Public support pages use the Web application's blue gradient header, rounded cards and light/dark palette, with responsive layouts and keyboard focus indicators. Styles are served from `/assets/support.css` under same-origin CSP; no external fonts or assets are loaded. Confirmation shows pending, completed and retry states while preserving explicit user submission and stale-response fencing.

The study name, public-page content and confirmation guidance are defined in [pages.ts](src/pages.ts); the confirmation email subject/body are defined in [mail.ts](src/mail.ts). Only the contact address and Gmail sender come from configuration settings. Replacing Web's shared research assets does not update these texts. For another study, review them together with its explanation, consent and actual mailbox retention policy, then rebuild and deploy Support if changes are needed. Keep private identities and study materials out of public source changes.

Run `pnpm --filter @aerpp/support exec playwright test e2e/public-pages.spec.ts` for standalone public-page browser checks without Firestore or mail. These cover mobile/desktop layouts, both color schemes and simulated confirmation responses. The emulator suite separately verifies real participant transactions.

## Email and privacy

GET `/email/confirm` only displays a confirmation page. Issued links carry consent ID and token in a fragment, which the browser removes from history and submits as same-origin JSON only on user confirmation. The confirmation page uses a compact, centered layout on desktop and mobile. Success directs the participant back to Web’s “次に進む” button; expired links cannot be retried or extended by resending and direct the participant to Web’s recovery guidance. Public wording applies to actual research participation rather than labeling every environment as a migration test. The page has no analytics or third-party assets; cache/referrer/CSP headers restrict exposure. It handles same-tab fragment navigation and fences stale responses. Platform logging still needs cloud acceptance.

Email confirmation creates owner-bound version-2 consent once. Pending links have a fixed, reception-capped deadline; confirmed consent has no application expiration. Resends preserve the original request/link and remain subject to the 60-second recipient cooldown and five-attempt hourly limit, including failed deliveries. Withdrawal requires confirmed consent. [Authentication persistence](docs/persistence.md#authentication) owns token/verifier storage, replay, completed-record cleanup and verification requirements.

Mail is sent outside retryable transactions. A lost delivery response may cause duplicate mail; retry the same prepared request. Shared Firestore counters bound calls to 120 per credential/minute, mail to 30 per credential/hour and five per recipient/hour. Counters contain hashed keys and window/count metadata; their `expireAt` is two counter windows after the window start. Apply and verify the Terraform-owned supportRateLimits TTL/index exemption before cloud activation. They are abuse controls, not deliverability or Gmail quota guarantees.

The Gmail adapter requests an access token with the operator-provided refresh token and calls `users.messages.send`. Local tests use an in-memory sink and cannot fall back to Gmail. Gmail recipients must match the selected web.nextPublicParticipantEmailPattern; missing or invalid cloud patterns fail configuration validation. Health checks refresh without sending mail, classify reauthorization failures and log safe operation/code fields; failures are recorded once at their HTTP operation boundary, including discovery/configuration failures before a maintenance result exists. Structured output uses Cloud Logging severity; configure independent Cloud Monitoring alerts before cloud activation. Follow [Gmail setup](../../docs/setup.md#obtain-the-gmail-refresh-token) for initial authorization and [reauthorization](../../docs/deployment.md#gmail-reauthorization) for an existing deployment.

Gmail sent-message retention is separate from Firestore retention and participant withdrawal. Publish the actual mailbox retention policy before enabling mail; Firestore cleanup does not delete sent messages. Cloud acceptance must separately exercise delivery, explicit fragment-based confirmation, one-time consumption, expiration, response loss and withdrawal, with selected recipients and send counts. Inspect application and platform logs for token exposure. Token health alone proves neither delivery nor sending quota.

### Gmail token health check

After completing the selected Support configuration, run `pnpm run support:check-gmail test`, or select `production` for that environment's independently configured sender. Extra arguments are rejected. The command rebuilds Support and uses its Gmail adapter to refresh a token without sending mail or connecting to Firestore. It reads only the selected Support settings, generates no credentials and retrieves no Secret Manager values.

The command exits nonzero on failure and writes sanitized evidence to `generated/<environment>/gmail-token-health.json`. It distinguishes reauthorization-required failures from temporary failures; tokens and raw Google responses are never recorded. Configuration or build failures can occur before evidence is written, so check both the exit status and evidence timestamp. Success establishes token refresh only, not sender identity, delivery, quota, deployed secret bindings or Cloud Run readiness.

## Local verification

Use the [development prerequisites](../../docs/development.md#prerequisites), then run from the workspace root. The emulator installer is needed only once; the Dev Container already installs Playwright Chromium.

```sh
pnpm run support:emulator:install
pnpm run check:support
pnpm run test:emulator
```

For separate local container checks, start Docker with Buildx and run:

```sh
pnpm run support:build-image test
pnpm run support:check-image test
```

`support:emulator:install` downloads the official binary and verifies its pinned SHA-256; the test runner rechecks that checksum. Handled installation failures remove temporary download files. An existing JAR is checked without downloading or replacing it; a checksum mismatch requires operator review. Emulator/browser tests require Java and the official standalone `cloud-firestore-emulator-v1.22.0.jar` at `private/tools/firestore/`, or an explicit `FIRESTORE_EMULATOR_JAR` pointing to that trusted installation. The runner invokes Java directly (no cloud CLI or login), allocates an isolated loopback port and disposable demo data, injects no cloud credentials, and terminates the emulator afterward. It uses the workspace Playwright Chromium installation. Unit tests do not need Java or a connection configuration.

The runner cancels tests if the emulator exits and stops both child processes on interruption. On POSIX hosts it also stops their process groups, including browser workers; shutdown escalates after five seconds. [Runner regression tests](scripts/run-emulator-tests.test.ts) use synthetic subprocesses to check startup failures, cancellation, cleanup and inherited-credential isolation without Java or the emulator JAR.

Synthetic unit tests exercise real local HTTP route policy, optimistic transaction races, exact survey retries, bounded/fair cleanup, mail errors and mixed-target configuration. The separate browser scenario runs confirmation, surveys, withdrawal, renewed consent, complete research deletion and retained operational history against real emulator transactions. Coverage includes late terminal receipts after physical deletion, original/submitting provenance, immutable retries, durable grant consistency and deletion-job progress. These do not prove cloud IAM/OIDC signatures, Gmail OAuth/delivery, platform logs, deployed indexes/TTL or on-premises Web integration.

Unit cases stay beside their owning module, with shared synthetic fixtures in `test-support/`:

| Boundary | Suite |
| --- | --- |
| Mail issuance, confirmation, expiry, resends and classification | [Email authentication](src/email-authentication.test.ts) |
| Reviewed grants, renewed authentication, original questionnaires and stale targets/generations | [Participation recovery](src/participation-recovery.test.ts) |
| Initial/follow-up eligibility and output-loss races | [Study participation](src/study-participation.test.ts) |
| Request projection, retries and persistence errors | [Participant handlers](src/participant-handlers.test.ts) |
| Withdrawal authorization and durable cleanup | [Authorization](src/withdrawal-authorization.test.ts), [cleanup](src/withdrawal-cleanup.test.ts) |

Email and recovery suites share fresh database/mail/runtime inputs from [the confirmation fixture](test-support/email-confirmation.ts). Handler and HTTP suites retain separate fixtures for their transport boundaries.

The Docker image is built locally for Linux/AMD64, bundles first-party modules, installs locked production dependencies and runs as `node`. These two image commands need no private cloud configuration: the target labels local evidence, and the check injects synthetic settings with container networking disabled. Runtime secrets/settings are injected after build; `support:build-image` records the immutable local image ID privately and performs no push/deploy. Public Docker inputs exclude tests, private configurations and assets. Closed test deployment follows the [Terraform preparation guide](../../infra/terraform/README.md#plans-and-ownership). Participant activation requires accepted data IAM, monitoring and consumer acceptance.

For a manual local start, build with `pnpm --filter @aerpp/support run build`, check `pnpm run env:check example support`, then run `pnpm run env:run example support start`. The public configuration binds `127.0.0.1:8090` and expects standalone Firestore on `127.0.0.1:8088` for data routes. Health/public/unauthorized requests do not require Firestore. Admission and maintenance are closed; the synthetic caller can only read information. This launcher does not start an emulator, expose mail-sink contents or connect to cloud. Use the automated emulator/browser suite for the complete synthetic participant flow.

### Real-mail acceptance

Follow [setup step 10](../../docs/setup.md#10-open-participant-admission-for-acceptance) for participant email acceptance; [Monitoring notification acceptance](../../infra/terraform/README.md#monitoring-and-acceptance) tests a separate delivery path. `support:check-mail test send-once` sends at most once per private claim, and `check` verifies explicit link confirmation. Register its sender as a test mailbox before sending; neither the test environment nor the synthetic pseudonym sets `dataPurpose` automatically.

The current standalone mail checker stores a synthetic `encryptedEmail` placeholder rather than a Web-compatible seal. Admin's full access export includes these records with `email` set to `復号できません` and consent `did` set to null; see the [access export contract](../admin/docs/data-export.md#participation-and-activity-fields). Selecting test-purpose data does not isolate the export, which always includes all purposes. For email plus successful contact-decryption acceptance, use normal Web participation with a dedicated test mailbox. The standalone checker verifies transport/confirmation only; it does not verify a Web-compatible email seal. Preserve its send-once claim and existing records.

## Shared information persistence

Information listing and creation use [@aerpp/firestore](../../packages/firestore/README.md), also used by Admin management. Existing bearer permissions, request validation, response formats and asynchronous TTL behavior remain unchanged. Admin edits/deletes use the shared repository directly, with update-time conflict checks; Support exposes no new edit/delete endpoints.

## Researcher test accounts

Support runtime `testEmailAddresses` is derived from private `config.json` `participants.testEmailAddresses`. Register dedicated researcher mailboxes before testing in production. Matching is exact after trim/lowercase normalization and does not override the configured mail-recipient policy. Classification is fixed when a confirmation is first issued and inherited by consent, attempts and answers. Configuration changes affect new confirmations only. Missing or invalid stored purposes remain unclassified and are included in Admin full source exports for offline review; operational views default to research-purpose records. See [configuration](../../docs/configuration.md#test-participants-in-production) and [persistence](docs/persistence.md#server-owned-data-purpose).

## Documentation

Use the [workspace documentation index](../../docs/README.md) for setup, configuration, targets and deployment. [Persistence and cleanup](docs/persistence.md) owns the domain transaction and retry contracts; [API contracts](../../packages/contracts/README.md) owns schemas and OpenAPI. Contributors follow [workspace conventions and verification](../../CONTRIBUTING.md).
