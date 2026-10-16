# Configuration examples

These examples also serve as starting points for an independent installation after cloning. The [setup guide](../../docs/setup.md) owns the ordered installation, credential acquisition, deployment and acceptance steps. This README owns the meaning of the example files and the fields to replace. Other reusable examples are indexed in [the template guide](../../docs/examples.md).

`config.json` and `secret.json` form a synthetic **local Web/Support** configuration. Validate it from the workspace root with `pnpm run env:check example`; this does not start any services. See [first-run commands](../../docs/development.md#first-run-without-cloud-credentials) for builds, Web preview and automated scenarios. Support requires a separately running loopback Firestore emulator and uses a mail sink. Admission and maintenance start disabled, so the unchanged configuration is not an interactive end-to-end participant demo. The same files also contain Admin, Gmail, Cloud Logging and infrastructure examples for an independent installation. These cloud-only inputs are not activated locally. The example loader accepts only `sender` in `support.gmail` and excludes that illustrative section before runtime projection; local Support always uses the mail sink and never resolves Gmail credentials.

## Files and execution targets

| File | Purpose |
| --- | --- |
| [config.json](config.json) | Non-secret operator inputs; runnable local defaults plus cloud field examples |
| [secret.json](secret.json) | Synthetic local keys and placeholder cloud credential objects; replace every value for a private cloud environment |
| [console-settings.example.json](console-settings.example.json) | Illustration of generated production registration inputs; never an application input |
| [llm/lms-medgemma.json](../common/llm/lms-medgemma.json) | Shared on-premises model preset selected by `web.llmPresetFile` |

`config.json.projectId: "demo-aerpp"` belongs to the local example. `console-settings.example.json.environment: "production"` describes a separate illustrative cloud output; these files are not one deployable production configuration. Actual Console inputs are generated for the private target selected in [setup step 2](../../docs/setup.md#2-prepare-the-google-cloud-project-and-private-configuration).

## Cloud configuration inputs

For script-assisted setup, [setup step 2](../../docs/setup.md#2-prepare-the-google-cloud-project-and-private-configuration) uses `env:setup init` to create cloud placeholders. For independent construction, copy [config.json](config.json) and [secret.json](secret.json) into a new private directory and edit the copies using this field reference and [environment construction](../../docs/environment-construction.md). Use `config/test/` for the `test` target and `config/production/` for `production`; preserve existing configurations and leave the public originals unchanged.

After copying, replace `demo-aerpp` with the real project ID, delete `support.local`, replace synthetic identities, addresses and every secret, and select cookie/debug settings, reception dates and backup policy. Keep `support.gmail` for cloud mail. Admin and Logging are unavailable under the `example` execution target but use these copied sections under test/production.

The table below describes the values to select in the copied private `config.json`:

| Setting | Cloud choice / example |
| --- | --- |
| `projectId` | `YOUR_PROJECT_ID`; distinct test and production projects |
| `shared.participantApiServerId` | Required; shared Web/Support/Admin scope within an environment. Use distinct test/production values, such as `research-test-01` and `research-production-01`; follow the Web image-name constraints below. |
| `web.llmPresetFile` | `lms-medgemma.json`; filename under shared `config/common/llm/`, even for private configurations; also the default when omitted |
| `web.sessionCookieSecure` | `"true"` for HTTPS; `"false"` for an intentionally HTTP deployment |
| `web.debugPagesEnabled` | `"false"` in production |
| `web.logLevel` | `"info"` |
| `web.nextPublicParticipantEmailPattern` | `"^participant@example[.]invalid$"`; required for cloud mail, select the actual restriction privately |
| `admin.adminAllowedEmails` | `"admin@example.invalid"`; comma-separated explicit login allowlist |
| `infrastructure.operatorAccount` | `operator@example.invalid`; explicitly selected gcloud account |
| `infrastructure.region` | `asia-northeast1` |
| `infrastructure.maxInstances` | `2` |
| `infrastructure.monitoring.notificationEmail` | `alerts@example.invalid` |
| `infrastructure.firestore.location` | `asia-northeast1`; select before creating the database |
| `infrastructure.firestore.manageExistingIndexes` | `true` |
| `infrastructure.firestore.automaticBackups` | `true` with `backupRetentionDays: 7` in the public example; choose retention of 1–98 days, or omit retention when disabled; see [backup policy](../../docs/configuration.md#firestore-automatic-backups) |
| `support.contactEmail` | `support@example.invalid`; also used by Web after reception closes |
| `support.gmail.sender` | `sender@example.invalid`; separate from Admin login and monitoring |
| `support.admissionOpen`, `support.maintenanceEnabled` | `false` until the applicable deployment checks are complete |
| `support.access.revoked` | `false` |
| `support.access.notBefore` | `2027-04-01T09:00:00+09:00`; replace with the intended reception start |
| `support.access.expiresAt` | `2027-05-01T17:00:00+09:00`; Web reception end, later than the shared access start |
| `support.access.backendStopsAt` | `2027-05-31T23:59:59+09:00`; Support caller/confirmation and maintenance stop, at or after Web reception end |
| `participants.testEmailAddresses` | `["researcher@example.invalid"]`; optional, defaults to `[]`, does not bypass admission or email restrictions |

`shared.participantApiServerId` also names the Web Docker image repository. Use 1–128 characters matching `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`: lowercase ASCII letters and digits, optionally separated by a single `.`, `_` or `-`. Separators cannot be leading, trailing or consecutive; uppercase letters, spaces, registry paths and tags are not accepted. The value `all` is reserved and rejected by Admin. Select different IDs for test and production during initial setup. Web image builds reject invalid names and, when both private configurations exist locally, matching test/production IDs.

The copied example starts with a long local reception period and seven-day backups. Select real reception dates and a backup policy before cloud validation; none of the example infrastructure fields create resources locally. Delete `support.local` from the cloud copy. Keep boolean-like Web settings as strings and Support/infrastructure switches as JSON booleans.

`logging: {}` is sufficient in `config.json`: location and namespace are derived from the selected region/environment. Optional overrides use `gcpLoggingLocation` and `gcpLoggingNamespace`. Authentication bypass must remain disabled; OAuth client IDs, service URLs, secret references and service identities are derived rather than additional manual inputs.

## Secret inputs

[secret.json](secret.json) illustrates every secret key and the nested cloud credential JSON shapes. The four local Web/Support keys contain synthetic runnable values; Admin/OAuth/Logging keys contain replacement placeholders. Local checks resolve only the local keys. Replace synthetic values and placeholders in the private configuration's `secret.json`: explicitly initialize the five application keys using the [application-key command](../../docs/setup.md#5-supply-stable-application-keys-and-review-shared-assets), or supply private keys through the organization's approved procedure; supply OAuth, Gmail and Logging credentials manually. Complete [Admin OAuth setup](../../docs/setup.md#create-the-admin-sign-in-oauth-client), [Gmail setup](../../docs/setup.md#obtain-the-gmail-refresh-token), application-key initialization and [Logging key registration after foundation setup](../../docs/setup.md#register-the-logging-service-account-key-in-secretjson) before all-app validation. For a new environment, the foundation phase in step 3 precedes these manual inputs; that section owns the required order and completion checks. Preserve the complete downloaded Web OAuth objects and existing Logging service-account object. Never use the public local secrets for a cloud configuration.

`SUPPORT_WEB_API_CREDENTIAL` uses `id.secret`: the ID is 1–64 letters, digits, underscores or hyphens; the secret is 43–128 of those characters. `SUPPORT_TOKEN_KEY` also requires 43–128 letters, digits, underscores or hyphens. Use separate Admin/Gmail clients bound to the selected project. No Admin or Support service-account key file is needed. See [secret ownership](../../docs/configuration.md#admin-and-logging).

Before initial Console generation, if the real Logging credential is unavailable, replace the copied `LOGGING_SERVICE_ACCOUNT_JSON` object with `"YOUR_LOGGING_SERVICE_ACCOUNT_JSON"` as explained in setup step 2. Restore the full real object at step 4; the illustrative object itself does not pass credential validation.

The Logging object's `type` placeholder represents `service_account`. Replace the entire illustrative object with the existing credential JSON, including its original fields and PEM newlines. The example contains no usable key.

## Generated Console settings

[console-settings.example.json](console-settings.example.json) illustrates production Console registration inputs, not editable application configuration. Its project, accounts and URLs are placeholders. Follow [setup step 2](../../docs/setup.md#2-prepare-the-google-cloud-project-and-private-configuration) to generate actual private values and step 4 to register the credential JSON objects and authorize Gmail; do not register the public example URLs. The private `console-settings.json` and `generated/<environment>/` outputs are generated; do not copy their values into `config.json`. Configuration validation does not establish cloud deployment, OAuth login or mail delivery.

## Shared application inputs

LLM presets and questionnaire JSON are maintained in [config/common](../common/README.md). They are shared across environments and are not copied into private configurations.

Presets selected by `web.llmPresetFile` must include `prompt.system`, `prompt.header` and `prompt.footer`. Follow the [LLM preset contract](../../docs/configuration.md#llm-preset-contract) for required fields and selected-configuration validation; preserve approved model, endpoint, generation, license and prompt inputs.
