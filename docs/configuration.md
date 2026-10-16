# Configuration

Follow [setup](setup.md) for script-assisted construction from cloning to cloud and operational-machine use. [Environment construction](environment-construction.md) explains the required state and ownership for independent manual/AI construction. Each private configuration's generated `console-settings.json` supplies its environment-specific Console registration values.

The supported environment names are `example`, `test` and `production`. Commands use `<environment>` to select `config/<environment>/` and `generated/<environment>/`; `example` is local-only. An environment's configuration means its settings and credentials, not a separate selection name.

## Current runtime names

Editable configurations select a local preset by `web.llmPresetFile`, projected as `LLM_PRESET_FILE`. Supply a filename such as `lms-medgemma.json`; its directory is always `config/common/llm/`. `SUPPORT_RECEPTION_EXPIRES_AT` is the Web reception cutoff, also displayed by Admin. `SUPPORT_BACKEND_STOPS_AT` is the independent Support stop displayed by Admin; Support derives its caller expiry from that same policy. `SUPPORT_API_CREDENTIAL` is the Web caller credential. Endpoint URLs are derived from `SUPPORT_API_BASE_URL`; runtime readers use only the current setting names.

Runtime readers parse supplied settings without writing files. Workspace tooling uses `prepareApplicationRuntime(environment, directory, { projects, apps })` to resolve the selected private configuration and materialize required logging credentials before launching applications. The options select targets and applications explicitly; ambient application settings never override the configuration.

## Shared configuration and secret providers

See [configuration examples](../config/example/README.md) for local versus cloud inputs, the canonical cloud template, secret object examples and conditional settings.

@aerpp/config owns environment selection, pure runtime readers, secret references and isolated process launches. Applications receive only their own projected settings. Web uses @aerpp/config/server/web; Admin uses @aerpp/config/server/admin. Both server entrypoints enforce server-only.

| Input/output | Owner |
| --- | --- |
| config/example/ | Public configuration/secret templates and runnable local Web/Support defaults |
| config/common/ | Public, environment-independent LLM presets, document version input and Web questionnaire JSON archived for Admin research ZIPs; see [shared inputs](../config/common/README.md) |
| config/test/config.json | Private test decisions and project/operator selection |
| config/production/config.json | Private production decisions and project/operator selection |
| secret.json beside each configuration | Sole editable secret source |
| console-settings.json | Generated environment-specific Console inputs; do not edit |
| docs/setup.md | Common script-assisted setup procedure from clone to operational use |
| docs/environment-construction.md | Independent construction reference: desired state, dependencies and ownership |
| config/example/console-settings.example.json | Public illustrative Console settings with synthetic values |
| generated/<environment>/auto.json | Derived/discovered metadata and applied Terraform output; do not edit |
| generated/<environment>/ | Generated runtime files, plans, image and deployment evidence |
| generated/reports/<purpose>/ | Environment-independent local audit reports and synthetic samples |

See [repository structure](structure.md) for app/package `generated/`, private working inputs, persistent tool state and publication boundaries. The generated Console companion remains beside its private configuration; application runtime generation stays under `generated/`.

Root `generated/` and `private/` are both non-public. Repository-managed runtime projections and operation records belong in `generated/`; operator working inputs and external-tool state belong in `private/`. Editable application settings and secret values remain authoritative in `config/<environment>/`, including application keys initialized through setup. A generated credential projection is not a second editable secret source, and an operation record is not necessarily reproducible or disposable.

Console settings are grouped by purpose: `admin.googleSignIn` contains Admin OAuth registration values, `support.gmail` contains Gmail OAuth values, and each app’s `cloudRun` contains service metadata. `accessControl` lists service identities and operator roles; `secretManager` identifies local secret inputs. `downloadedClientJsonDestination` tells you where to paste each downloaded JSON object. Service URLs in this file do not establish deployment or acceptance.

OAuth branding decisions such as the app name, support/developer contacts, homepage, policy URLs and audience type are not generated inputs. Use the branding and audience links in `admin.googleSignIn`. Console automatically adds applicable domains from the saved OAuth client URIs; [review authorized domains after client creation](setup.md#review-authorized-domains-after-client-creation), together with any domains needed for branding URLs. Manual preregistration of client URI domains is not required. Automatic registration does not establish domain ownership or replace Google's required verification.

Only config/example/ and config/common/ are public. Do not add app-local .env files. Root .env is for development tools only. Preserve literal secret bytes. Never fetch Secret Manager values. Application keys can be initialized through the explicitly invoked `env:prepare-secrets` command for an unused installation; [setup](setup.md#5-supply-stable-application-keys-and-review-shared-assets) owns its generation, replacement and upload procedure. OAuth and service-account credentials are never automatically created or rotated. Secret names and references are fixed by @aerpp/config, not repeated in config.json. Application startup does not discover endpoints or modify infrastructure.

The guided [setup](setup.md#2-prepare-the-google-cloud-project-and-private-configuration) uses `env:setup init` to create private cloud placeholders. Independent construction can copy `config/example/config.json` and `secret.json` into a new private directory and replace the local/example values. The lower-level `env:init` uses the same cloud initializer. Preserve existing configurations; neither initialization nor copying is needed for an existing installation. Complete operator inputs before `env:sync` with `--offline` or `--refresh`.

## Configuration authority and application order

The boundaries below apply to initial setup and subsequent changes. Follow [setup](setup.md) for the initial sequence, including Console registration before all credentials and foundation outputs are available.

- Private `config.json` owns project/operator selection, region and desired resource settings; `secret.json` owns each environment's independent credentials.
- Terraform owns the remote backend's infrastructure state and applied resource configuration. Database location is explicit and immutable. Secret values must not enter Terraform variables, plans or state.
- `infra:terraform` writes validated applied outputs only to `auto.json.terraform.support`; `env:sync` cannot override this namespace. Serialize writers within each environment.
- Application projection resolves only the selected consumer's inputs. Validate it once those inputs exist; early Console generation does not establish full application readiness.
- Delivery binds immutable images and numeric runtime-secret versions to a reviewed plan and separate acceptance checks. Editing source inputs alone does not update a running service.

Set infrastructure.operatorAccount explicitly in each private configuration. Test and production may use the same or different Google accounts. Each gcloud operation and the short-lived Terraform token uses the selected account. It does not rely on whichever account happens to be globally active.

## Runtime projection boundaries

Each application resolves only its own settings and secrets from the selected configuration. Web receives the Support origin and caller credential; it does not read Admin OAuth or Gmail secrets. Support receives the derived caller verifier, never the raw caller secret. Admin contact exports receive the same existing `SESSION_SEAL_PASSWORD` and `IDENTIFIER_HASH_SECRET` keys used by Web, projected as secrets for local and hosted execution rather than Terraform values.

The [Support policy](#support-editable-configuration) owns the shared Web/Support access policy, independent backend stop and contact address. The [OAuth objects](#downloaded-oauth-client-json) own client IDs/secrets, and the [private mailbox list](#test-participants-in-production) is projected only to Support. Never add independent aliases or per-app copies of those inputs.

## Support editable configuration

The private configuration owns Support policy. Follow [reception changes during maintenance](study-operations.md#reception-changes-during-maintenance) to recompile and deploy affected consumers; Admin has no date editor. The [public field reference](../config/example/README.md#cloud-configuration-inputs) lists copy-and-edit examples.

Keep `notBefore`, `expiresAt`, `revoked` and `backendStopsAt` together in `support.access`. Migrate the former `support.webAccess` fields and `support.backendStopsAt` into this object; obsolete aliases are rejected. Web and Admin use this shared object without requiring Support's Gmail secrets.

### Editable policy

| Configuration field | Meaning |
| --- | --- |
| `support.admissionOpen` | Controls new mail and email confirmation; enable through the [deployment acceptance sequence](deployment.md#infrastructure-and-support-delivery) |
| `support.maintenanceEnabled` | Permits scheduled work within the [maintenance window](#scheduled-maintenance-window) |
| `support.contactEmail` | Public inquiry/withdrawal contact, also available in Web after reception closes |
| `support.access.notBefore`, `support.access.expiresAt` | Shared Web/Support access policy: Support enforces the start; Web gates study operations at the reception end; ISO 8601 timestamps with an explicit timezone, such as `2026-09-21T09:00:00+09:00` or `2026-09-21T00:00:00Z`. The end must be later than the start |
| `support.access.revoked` | Explicit Support caller revocation |
| `support.access.backendStopsAt` | Independent Support caller/confirmation and maintenance stop; timezone-qualified ISO timestamp at or after `support.access.expiresAt` |
| `support.gmail.sender` | Selected Gmail sender; OAuth credentials remain in `secret.json` |

### Reception and participant validity

Runtime projection derives the following values from that single policy:

| Source | Consumer and derived value |
| --- | --- |
| `support.contactEmail` | Web's required `SUPPORT_CONTACT_EMAIL`; do not add `web.supportContactEmail` |
| `support.access.notBefore`, `support.access.backendStopsAt` | Support caller validity as Unix milliseconds |
| `support.access.expiresAt` | Web/Admin's required `SUPPORT_RECEPTION_EXPIRES_AT`; do not add `web.receptionExpiresAt` or `admin.supportReceptionExpiresAt` |
| `support.access.backendStopsAt` | Admin's required `SUPPORT_BACKEND_STOPS_AT`; do not add `admin.supportBackendStopsAt` |

Web uses the reception cutoff to gate study operations and show the closed screen. Support may continue to accept authorized calls, including retained terminal audit delivery, until its independent backend stop. Manual caller revocation and admission/maintenance switches retain their roles. Expired settings remain valid at startup. Admin displays both dates without disabling reads or exports. Reproject and update each affected consumer when changing the shared policy. These dates control application requests, not Cloud Run shutdown, Scheduler deletion or database erasure.

Confirmed participant authority, new browser seals and completed consent proof have no application expiration or reception deadline. Pending email links retain their original fixed deadlines; old-version browser seals retain their embedded expiry. These lifetimes are separate from reception permission; see [participant session lifetime](study-operations.md#participant-session-lifetime).

### Caller identity and permissions

`secret.json.SUPPORT_WEB_API_CREDENTIAL` contains `id.secret`. Projection derives the caller ID and SHA-256 verifier; Support receives only the verifier, while the raw caller secret remains exclusive to Web runtime settings. Email-token retries compare the derived token with its stored verifier and need no separate key ID. Do not maintain `support.credentials` or `support.tokenKeyId` in `config.json`.

The source allowlist defines Web operations and excludes operator-only `addInformation` and participant-history erasure in every environment. Do not maintain `support.access.operations` in `config.json`.

`shared.participantApiServerId` supplies the `serverId` shared by Web, Admin and Support; do not place it in `web`. Select distinct test/production values that satisfy the [Web image-name constraints](../config/example/README.md#cloud-configuration-inputs), since this value also names the Web Docker image repository.

Runtime projection validates environment agreement, project binding, HTTPS cloud origins, credential identities and local/cloud isolation. Applied Terraform output supplies the service base origin; `@aerpp/config/support-routes` supplies fixed paths without per-endpoint discovery.

### Mail and environment isolation

Test and production use independent Support services, projects, runtime/Scheduler identities and Gmail settings. Each Gmail client is separate from its Admin OAuth client. Sender, contact and monitoring addresses are independently selected and need not be the same Google account. See [Gmail setup](setup.md#obtain-the-gmail-refresh-token).

Cloud mail recipients must match `web.nextPublicParticipantEmailPattern` in the selected configuration. Support derives its pattern from that Web setting, using the same syntax and flag normalization; Gmail has no separate recipient list. Cloud projection rejects missing, empty or invalid patterns. Production does not inherit the test pattern or sender.

Local Support uses `support.local` with a loopback origin, standalone Firestore emulator and synthetic mail sink. The example loader validates the sender-only `support.gmail` illustration and removes it before runtime projection. It resolves no cloud secrets and activates no Admin, Logging or infrastructure. Cloud configurations reject `support.local`.

### Web settings and retained state

Editable Web settings include `web.sessionCookieSecure` and `web.llmPresetFile`; caller, identifier and session secrets come from the fixed `secret.json` keys. Keep identifier/session secrets stable and preserve Web's private SQLite coordination volume across container replacement. Its metadata is not application-encrypted; see the [data inventory](data-handling.md#web-and-participant-browser).

## LLM preset contract

`web.llmPresetFile` selects a filename under `config/common/llm/`; the default is `lms-medgemma.json`. Each preset requires `model`, `baseUrl`, `generation`, `license` and a top-level `prompt` object. `prompt.system` must be a nonblank string; `prompt.header` and `prompt.footer` must be present as strings, including when intentionally empty. No other keys are allowed inside `prompt`. The [canonical preset](../config/common/llm/lms-medgemma.json) and [template guide](examples.md#local-model-settings) define the supplied inputs.

Preserve the approved model, endpoint, generation settings and exact prompt strings unless a change is explicitly authorized. Validate the configuration that selects the preset with `pnpm run env:check test web` or `pnpm run env:check production web`; the example check validates only its own selected preset. Images contain their own preset copy, so an authorized change requires rebuilding/checking and replacing the affected artifact through [deployment](deployment.md). Configuration validation does not contact LM Studio or establish inference or operational acceptance.

## Admin and logging

Admin fixes operational views to `shared.participantApiServerId`, projected as required `PARTICIPANT_API_SERVER_ID`. It has no server selector or URL override. Missing, blank and `all` values are rejected. Notices, Cloud Logging and the explicitly environment-wide raw research archive retain their documented scope.

Admin requires an explicitly selected GCP project and keeps NextAuth Google login and the explicit email allowlist. Direct runtime starts enforce the same checks. Authentication bypass additionally requires `NODE_ENV=development`, `AERPP_ENVIRONMENT=example`, a `demo-` project, a loopback Firestore emulator and the explicit bypass flag, without a cloud impersonation identity. Hosted Cloud Run uses its runtime service identity. Local Admin uses the selected gcloud operator to impersonate the Terraform-managed Admin identity; no Admin service-account JSON is needed. Terraform grants impersonation only on that identity. On-premises Logging uses the existing key stored as LOGGING_SERVICE_ACCOUNT_JSON in secret.json; tooling derives its identity and writes the required private runtime file automatically. Runtime accounts must belong to the selected project. Local development targets test; production development launches are rejected.

Admin's deterministic planned URL and OAuth Console inputs are derived from project metadata. Register the exact callback values manually. URL checks do not prove successful OAuth. Secrets are uploaded as numeric versions from local secret.json; no command downloads them.

The required secret.json keys are:

| Consumer | Keys |
| --- | --- |
| Web | IDENTIFIER_HASH_SECRET, SESSION_SEAL_PASSWORD, SUPPORT_WEB_API_CREDENTIAL |
| Admin | NEXTAUTH_SECRET, ADMIN_GOOGLE_OAUTH_CLIENT_JSON, SESSION_SEAL_PASSWORD, IDENTIFIER_HASH_SECRET (same existing keys as Web, for contact exports and PDF document IDs) |
| Support | SUPPORT_TOKEN_KEY, SUPPORT_GMAIL_OAUTH_CLIENT_JSON, SUPPORT_GMAIL_REFRESH_TOKEN |
| On-premises Logging | LOGGING_SERVICE_ACCOUNT_JSON (existing service-account JSON object; do not stringify or escape the whole JSON) |

Terraform manages service-account resources and IAM. No Admin or Support key JSON is maintained. Logging's generated credential file is not an operator input. OAuth settings remain operator-supplied; application keys are supplied privately or initialized by the explicit setup command. Both remain authoritative in `secret.json` and never enter Terraform state.

Follow [Logging key registration](setup.md#register-the-logging-service-account-key-in-secretjson) to obtain the selected identity's JSON key, import the complete object into the private secret store and run the independent Logging configuration check. This credential remains a local operator input rather than a Secret Manager upload.

## Downloaded OAuth client JSON

Paste the complete downloaded Google **Web application** client JSON as an object in secret.json, just like LOGGING_SERVICE_ACCOUNT_JSON. Do not stringify or escape the JSON. The canonical [secret template](../config/example/secret.json) shows the `ADMIN_GOOGLE_OAUTH_CLIENT_JSON`, `SUPPORT_GMAIL_OAUTH_CLIENT_JSON` and separate `SUPPORT_GMAIL_REFRESH_TOKEN` entries. Use separate Admin/Gmail clients in the selected environment project; follow [OAuth setup](setup.md#create-the-admin-sign-in-oauth-client) to acquire them.

Keep the other downloaded fields in each object; tooling reads only web.project_id, web.client_id and web.client_secret. The project must match config.json.projectId. Desktop/installed clients and stringified JSON are rejected. The Gmail refresh token remains a separate operator-supplied secret.

Split OAuth fields (`admin.adminGoogleOauthClientId`, `support.gmail.clientId`, `ADMIN_GOOGLE_OAUTH_CLIENT_SECRET` and `SUPPORT_GMAIL_CLIENT_SECRET`) are unsupported editable inputs. Runtime fields and cloud secret references are derived from the complete objects. Each app reads only its own OAuth object, and Web never resolves OAuth secrets. env:sync can generate Console registration instructions before credentials are supplied; env:check validates the selected application. This does not create clients, rotate credentials or prove OAuth login/mail acceptance.

## Validation and generation

Use `pnpm run env:check <environment>` to validate all consumers once their inputs are complete. An optional app argument (`web`, `admin`, `support` or `logging`) validates only that consumer without resolving another app's secrets. The `example` target supports Web/Support. `env:generate` is an optional private runtime-JSON export; managed launches read configurations directly and bundle export generates its own Compose settings. It neither deploys nor sends mail.

The Web and Admin pure readers take injected settings without filesystem access. File-based LLM checks use web-validation. Never change models, prompts or generation parameters during configuration cleanup. NODE_ENV selects framework runtime behavior and never selects the cloud target.

## Firestore automatic backups

Set infrastructure.firestore.automaticBackups to true and backupRetentionDays to an explicit integer from 1 to 98 to create a daily backup schedule. For example, 7 retains each daily backup for seven days. False or omitted automaticBackups creates no schedule and must omit backupRetentionDays. Test and production select this policy independently. Terraform projects only the selected policy; it never copies backups between projects.

Existing schedules are protected against deletion, replacement and ordinary updates by the plan guard. Changing retention after creation needs a separately reviewed policy change. A schedule does not establish completed backups or successful restoration; verify those separately. Restoring historical records requires reconciling withdrawal and deletion history before any restored data can serve participants.

## Scheduled maintenance window

Scheduler HTTP attempts allow 75 seconds around Support’s 60-second Cloud Run request setting. Withdrawal cleanup retains its shared 40-second work budget, and that budget does not cancel in-flight Firestore commits. Changes to source settings require separately authorized infrastructure delivery before they affect deployed jobs.

`support.maintenanceEnabled` permits scheduled work only from `support.access.notBefore` minus twelve hours until `support.access.backendStopsAt` (end exclusive). Both jobs use the same pure runtime predicate and stop at the backend deadline. Revoked or other-environment credentials cannot open this window. Outside the window, OIDC-authenticated invocations skip data/mail work and record that outcome. This is a processing boundary, not automatic pausing of Cloud Scheduler. Failed cleanup remaining after the backend stop requires operator recovery.

## Test participants in production

Register researcher-only test mailboxes in the selected private `config.json` before participation:

```json
{
  "participants": {
    "testEmailAddresses": ["researcher@example.invalid"]
  }
}
```

The list defaults to empty when omitted. Addresses are trimmed, lowercased and matched exactly; duplicates are removed. This list classifies data and does not grant admission, Admin access or bypass `web.nextPublicParticipantEmailPattern`. Test addresses must also satisfy the existing recipient policy. Researchers must use dedicated addresses that are never used for research participation.

Only Support receives the list, inside its private runtime settings. It is not projected to Web/Admin, public client settings, logs or research exports. Apply configuration through the normal selected-configuration Support delivery procedure; editing config.json alone does not change a deployed revision. Never include real mailboxes in public examples.

At the first email-confirmation request, Support stores `dataPurpose: "test"` for a registered mailbox and `"research"` otherwise. Exact resends, confirmation, analysis attempts and surveys preserve this classification; later configuration changes never reclassify stored records. Existing records without a recognized purpose remain unclassified, including pending confirmations created before this change. Do not infer their purpose from server ID, environment or the current email list. Admin operational views default to research records; full source exports retain test/unclassified records for offline review. See [Admin aggregation](../apps/admin/docs/monitoring.md#survey-aggregation).
