# Script-assisted environment setup

This guide uses maintained scripts to construct a new test or production environment, with manual input at project selection, plan review, Console credential registration and acceptance. Run commands from the workspace root in the order shown. Complete test acceptance before repeating the procedure for production; the two environments have independent credentials and evidence.

For source builds without cloud credentials, use [first-run local verification](development.md#first-run-without-cloud-credentials). For people or AI constructing resources independently, [environment construction](environment-construction.md) explains the required configuration, dependencies, ownership and final state; it is a reference, not an alternative command sequence. [Deployment](deployment.md) owns later updates and recovery.

An existing installation whose data was intentionally reset still owns its infrastructure, credentials and application keys. Use the deployment procedure rather than initializing it again or replacing keys. Register the checked Web image's questionnaires and document originals again if their archives were cleared, then export a fresh bundle. Resetting cloud data does not clear local Web coordination state; any local reset must be explicitly coordinated with the operational machine.

Scripts select the private configuration's project and operator explicitly. Keep real identifiers, URLs and credentials private. The `example` target is local-only and cannot construct cloud resources. Initial setup keeps admission and maintenance closed; deployment and acceptance remain separate stages.

## 1. Prepare the source and development machine

```sh
git clone <repository-url> <workspace-directory>
cd <workspace-directory>
```

The Dev Container reads the root `.env` for development tools. If it is absent, copy [.env.example](../.env.example) to `.env` at the repository root; an empty `.env` also suffices when no tool token is needed. Preserve existing contents and keep application settings and secrets in their private configurations.

The checked-in [Dev Container configuration](../.devcontainer/devcontainer.json) reads that root `.env` and forwards the application ports. It does not declare a host `~/.codex` bind mount or require a Codex account for application builds/tests. Configure optional agent tooling separately and preserve existing tool settings; [local agent guidance](development.md#local-agent-guidance) explains the private instruction and state directories.

Start Docker and use VS Code's **Reopen in Container** command with the Dev Containers extension installed. Initial setup installs workspace dependencies and Playwright Chromium; no additional install is needed after it succeeds. The supplied configuration is the maintained development environment. [Development prerequisites](development.md#prerequisites) list its tool versions and native-setup requirements.

The **development host also needs LM Studio** for actual analysis. Run it outside the Dev Container with the selected model; the supplied preset reaches its server through `http://host.docker.internal:1234/v1`. Follow [model configuration](../apps/web/README.md#model-configuration) for server settings. Source builds and stubbed tests can run before LM Studio is available. The separate [operational environment](environments.md#intended-environment) is an Apple Silicon Mac with Docker Desktop and LM Studio.

**Completion:** The prepared workspace is ready for [first-run local verification](development.md#first-run-without-cloud-credentials). Complete its public configuration/build checks before continuing with cloud setup. For the following cloud/image steps, also install the Terraform version pinned in [versions.tf](../infra/terraform/versions.tf) on PATH or at `private/tools/terraform/terraform`, preserve the provider lockfile, and confirm `docker version` and `docker compose version` succeed.

## 2. Prepare the Google Cloud project and private configuration

Select or create the project's Google Cloud project and enable billing in Console. Choose the operator account for this environment. The setup scripts do not create projects or attach billing accounts.

Select the environment name for this shell; set it again in a new terminal. `AERPP_ENVIRONMENT` supplies the same `<environment>` used in every `config/<environment>/` and `generated/<environment>/` path below: `test` selects `config/test/`, and `production` selects `config/production/`. The commands pass this shell variable explicitly; exporting it is unnecessary.

```sh
AERPP_ENVIRONMENT=test
# Use production for the independently configured production project.
pnpm run env:setup "${AERPP_ENVIRONMENT}" init <project-id>
```

`init` creates private `config.json` and `secret.json` under `config/<environment>/`, using the maintained cloud template. It makes no cloud calls and refuses to overwrite either file. For an existing configuration, resume with its editable inputs instead of initializing again. Public [configuration and secret examples](../config/example/README.md) remain copy-and-edit references for independent construction and local verification.

Complete `config/<environment>/config.json` using the [cloud field reference](../config/example/README.md#cloud-configuration-inputs):

| Operator input | Required decision |
| --- | --- |
| `projectId`, `infrastructure.operatorAccount`, `infrastructure.region` | The selected project, authenticated operator and resource location |
| Firestore and monitoring inputs | Database location, backup enablement/retention and notification destination |
| `shared.participantApiServerId` | Distinct test/production server identities |
| Support reception and caller policy | Actual study dates, closed admission/maintenance and allowed recipient pattern |
| Admin, Gmail and public contact settings | Admin allowlist, sending account and contact address |
| Web inputs | Approved local LLM preset, delivery-matching cookie security and production debug disabled |

Keep the generated missing-Logging placeholder until step 4. The scripts prepare application keys in step 3; supply the OAuth objects, Gmail refresh token and Logging key manually in step 4. Register dedicated acceptance mailboxes in `participants.testEmailAddresses` before any mail/participation acceptance; follow the [test-participant policy](configuration.md#test-participants-in-production).

```sh
pnpm run auth:login "${AERPP_ENVIRONMENT}"
```

Use `--no-browser` when this machine cannot open a browser. Global project/account switching, Firebase login and a separate ADC login are unnecessary.

**Completion:** The selected private configuration contains the actual operator decisions and its operator is authenticated. No example identity, local Support emulator settings or runnable public secret belongs in a completed cloud configuration.

## 3. Provision the Terraform foundation

```sh
pnpm run env:setup "${AERPP_ENVIRONMENT}" plan
```

`plan` checks the configuration, active project and billing, enables the required APIs, refreshes `console-settings.json`, creates/verifies the protected Terraform state backend and saves a foundation plan. This phase can change API/backend configuration; it does not apply Terraform-managed resources or deploy applications.

Review `generated/<environment>/support-terraform/plan.json` for the selected project, locations, Firestore retention, IAM and resource changes. Then apply that saved plan:

```sh
pnpm run env:setup "${AERPP_ENVIRONMENT}" apply
```

`apply` runs the reviewed Terraform plan, regenerates Console settings, initializes missing/example application keys and uploads the three independent Admin secret versions. Existing private keys are preserved. For an explicitly requested replacement in an unused installation only, `apply --replace-secrets` replaces the five application keys; omit the flag on retries.

Initial Firestore operations run serially and can take more than an hour. Follow `generated/<environment>/support-terraform/terraform.log`; the wrapper renews operator tokens during execution. Run one infrastructure operation at a time per environment. If Terraform partially fails, inspect its state and review a fresh plan; use [state recovery](../infra/terraform/README.md#recovery) if it could not save state. If apply succeeded and a subsequent secret upload failed, resume with `env:prepare-secrets --upload` in step 5 rather than reapplying the saved plan.

**Completion:** The foundation is applied, three Admin versions are prepared, and `config/<environment>/console-settings.json` has current Console inputs. Application OAuth credentials, Logging keys, images, Cloud Run services and Scheduler jobs are not created by this initial phase. Resource ownership and the phase boundaries are explained in [environment construction](environment-construction.md).

## 4. Register Console credential JSON

Register Logging, Admin and Gmail sending downloads in that order in `config/<environment>/secret.json`. Use the generated `console-settings.json` for this configuration, not the [synthetic output example](../config/example/console-settings.example.json).

| Console download | Destination in secret.json | Object to paste |
| --- | --- | --- |
| Logging service-account JSON key | `LOGGING_SERVICE_ACCOUNT_JSON` | Complete download, with `type`, `project_id`, `private_key` and other fields directly inside the entry |
| Admin Web application OAuth client | `ADMIN_GOOGLE_OAUTH_CLIENT_JSON` | Complete download, including Google's outer `web` key |
| Gmail sending Web application OAuth client | `SUPPORT_GMAIL_OAUTH_CLIENT_JSON` | Complete download, including Google's outer `web` key |

The [canonical secret template](../config/example/secret.json) shows the formats. Preserve the downloaded fields and private-key newline escapes. Do not add a `json` wrapper, stringify an object or replace unrelated secret entries. Discard redundant downloads after successful import and validation; keep credentials out of chat, Git, terminal history and screenshots.

### Register the Logging service-account key in secret.json

1. Confirm `console-settings.json.projectId` and `accessControl.onPremisesLogging.serviceAccountEmail`. Open `accessControl.serviceAccountsUrl` and select that exact Terraform-created Logging account.
2. Obtain its JSON key through the approved procedure. Reuse an existing valid key when available. For a new project without a key, an authorized administrator can use **Keys → Add key → Create new key → JSON** if organization policy permits; see Google's [key creation instructions](https://cloud.google.com/iam/docs/keys-create-delete#creating). If restricted, ask the administrator to supply the approved credential.
3. Check the download's `type` is `service_account`, `project_id` matches the selected project and `client_email` matches the Logging identity. Replace `secret.json.LOGGING_SERVICE_ACCOUNT_JSON`, including its missing-credential placeholder, with the complete object.
4. Validate the imported Logging input:

```sh
pnpm run env:check "${AERPP_ENVIRONMENT}" logging
```

This writes the generated private Logging runtime credential file. It does not upload the key to Secret Manager or prove live log delivery. Do not hand-edit the generated file or create Admin/Support service-account keys.

### Create the Admin sign-in OAuth client

1. Open `admin.googleSignIn.brandingConsoleUrl`. If Auth Platform is not configured, select **Get started** and supply the app name, user support email, audience and developer contact email. Complete Branding and use `admin.googleSignIn.audienceConsoleUrl` for Audience. These are operator decisions; see [OAuth configuration responsibilities](environment-construction.md#oauth-branding-and-audience).
2. Open `admin.googleSignIn.oauthClientsConsoleUrl` and create a **Web application** client with a recognizable Admin name.
3. Register `admin.googleSignIn.authorizedJavaScriptOrigins` and `admin.googleSignIn.authorizedRedirectUris` exactly as generated, including paths and ports. Save the client and [review authorized domains](#review-authorized-domains-after-client-creation).
4. Download the JSON and replace `secret.json.ADMIN_GOOGLE_OAUTH_CLIENT_JSON` with the complete object, retaining `web`.
5. Review `admin.googleSignIn.allowedLoginEmails`. The application allowlist is separate from OAuth test users; configure each intentionally.

### Register the Gmail sending OAuth client

1. Open `support.gmail.oauthClientsConsoleUrl` and create a separate **Web application** client for Gmail sending. Preserve Admin's client and redirects.
2. Register `support.gmail.authorizedRedirectUris`, including Google's OAuth Playground callback, save and review authorized domains.
3. Download its JSON and replace `secret.json.SUPPORT_GMAIL_OAUTH_CLIENT_JSON` with the complete object, retaining `web`.

### Obtain the Gmail refresh token

1. If the app is **External** with publishing status **Testing**, open `admin.googleSignIn.audienceConsoleUrl`, use **Audience > Test users > Add users**, add `support.gmail.senderEmail`, and save. This is the sender, not recipients or research participants. Review [publication and token lifetime](#oauth-publication-and-token-lifetime).
2. Open [OAuth Playground](https://developers.google.com/oauthplayground/), enable **Use your own OAuth credentials** and supply `web.client_id` and `web.client_secret` from this configuration's Gmail client. Use Google's endpoints, the server-side flow, offline access and the consent prompt. The Playground sends these credentials through Google's proxy; never share a credential-bearing link. Its default client revokes tokens after 24 hours, so use the dedicated client.
3. In Playground **Step 1**, enter `support.gmail.requiredScopes` under **Input your own scopes**, select **Authorize APIs**, and consent as `support.gmail.senderEmail`. The required sending scope is `https://www.googleapis.com/auth/gmail.send`.
4. In Playground **Step 2**, select **Exchange authorization code for tokens**. Save the **Refresh token** in `secret.json.SUPPORT_GMAIL_REFRESH_TOKEN`; do not save the short-lived access token. Reuse a valid token for this client when available, never another environment's token.

### OAuth publication and token lifetime

[OAuth responsibilities](environment-construction.md#oauth-branding-and-audience) explain audience, branding and verification decisions. External apps in Testing normally receive seven-day refresh tokens when requesting Gmail scopes. Production removes that Testing-specific limit but tokens can still be revoked or expire; see Google's [expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration). A revoked grant needs [operator reauthorization](deployment.md#gmail-reauthorization).

### Review authorized domains after client creation

After saving each OAuth client, check **Branding > Authorized domains** for the domains automatically added from its registered URIs. Client URI domains need no separate manual preregistration. Review domains used by the manually selected homepage and policy URLs separately. Registration does not establish ownership or brand verification; see [OAuth configuration responsibilities](environment-construction.md#oauth-branding-and-audience).

**Completion:** All three credential objects and the Gmail refresh token are saved for the selected project. Sender registration is complete when OAuth Testing requires it. No application login, mail or Logging delivery has yet been accepted.

## 5. Supply stable application keys and review shared assets

The foundation helper already prepares the five application keys and three Admin versions. Inspect completion messages, not secret values. To resume a failed post-foundation upload without replacing existing keys:

```sh
pnpm run env:prepare-secrets "${AERPP_ENVIRONMENT}" --upload
```

For explicit key initialization outside the helper, `pnpm run env:prepare-secrets "${AERPP_ENVIRONMENT}"` prepares missing/example values for an unused installation. `--replace` intentionally replaces all five keys and is restricted to unused installations. Keep the Web coordination volume and its matching session/identifier keys together. [Credential ownership](environment-construction.md#credentials-and-secret-values) explains which values are generated and which are manual.

Copy and adapt the complete [private research asset set](examples.md#research-assets) and review the [shared questionnaire definitions](examples.md#questionnaire-definitions). Keep the approved local model, prompts and generation settings. Distribution images require the private assets; questionnaire registration happens in step 11.

**Completion:** Stable keys are prepared, uploads are complete and the study assets/questionnaires are ready for image construction.

## 6. Validate the completed configuration

```sh
pnpm run env:setup "${AERPP_ENVIRONMENT}" check
```

`check` runs all four consumer configuration validators and then the Gmail token-refresh check. It builds Support for that check, sends no mail, creates no credentials and deploys no services. Failure of configuration validation stops before token refresh. The evidence is `generated/<environment>/gmail-token-health.json`.

For an independent consumer diagnosis, use `pnpm run env:check "${AERPP_ENVIRONMENT}" logging` (or `web`, `admin`, `support`). The lower-level `pnpm run support:check-gmail "${AERPP_ENVIRONMENT}"` refreshes Gmail only. See [token health evidence](../apps/support/README.md#gmail-token-health-check) for failure handling.

**Completion:** All four consumer checks and Gmail token refresh succeed. Configuration and token refresh do not establish login, mail delivery, Logging delivery, completed backups or restoration. Proceed with the application-specific scripts below; review each plan before apply.

## 7. Deploy Support with admission closed

For a new environment, confirm `support.admissionOpen: false` and `support.maintenanceEnabled: false`.

```sh
pnpm run support:build-image "${AERPP_ENVIRONMENT}"
pnpm run support:check-image "${AERPP_ENVIRONMENT}"
pnpm run support:prepare-deployment "${AERPP_ENVIRONMENT}" --apply
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" plan
```

Preparation pushes the locally checked image and uploads secret versions. Review the plan before applying it:

```sh
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" apply
pnpm run support:check-cloud "${AERPP_ENVIRONMENT}"
```

**Completion:** Cloud checks verify the selected image, secret version and serving revision while participant admission remains closed.

## 8. Verify maintenance and data access

Set only `support.maintenanceEnabled` to `true` in `config.json`; keep `admissionOpen` false. Apply the runtime change using the same image.

```sh
pnpm run support:prepare-deployment "${AERPP_ENVIRONMENT}" --apply
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" plan
```

After reviewing the plan:

```sh
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" apply
pnpm run support:check-cloud "${AERPP_ENVIRONMENT}"
pnpm run support:check-data "${AERPP_ENVIRONMENT}"
pnpm run support:check-scheduler "${AERPP_ENVIRONMENT}" run
```

Run this acceptance stage within the maintenance window, from twelve hours before `support.access.notBefore` until `support.access.backendStopsAt`. A study scheduled far in the future will skip work and cannot pass admission acceptance yet. Plan the acceptance date accordingly; do not treat a skipped job as successful work.

The data check writes rate-limit counters. Scheduler runs withdrawal cleanup and Gmail token health; neither job sends mail. Wait for execution logs, then run:

```sh
pnpm run support:check-scheduler "${AERPP_ENVIRONMENT}" check
pnpm run support:check-monitoring "${AERPP_ENVIRONMENT}" check
```

If Scheduler logs have not arrived, wait and repeat its `check` command without another `run`.

The monitoring check verifies the configured notification channel and alert policy without sending a notification. Follow [notification acceptance](../infra/terraform/README.md#monitoring-and-acceptance) for one explicitly selected test event and manual mailbox receipt confirmation. Gmail token health and data/Scheduler acceptance do not prove that operational alerts arrive; record receipt separately from generated check evidence.

**Completion:** TTL/data access checks succeed and saved evidence shows both jobs completed work, without a maintenance-window skip, with HTTP 200 on the selected revision. Monitoring configuration is checked and operator notification receipt is recorded separately.

## 9. Deploy Admin and verify Google login

```sh
pnpm run admin:build-image "${AERPP_ENVIRONMENT}"
pnpm run admin:check-image "${AERPP_ENVIRONMENT}"
pnpm run admin:prepare-terraform "${AERPP_ENVIRONMENT}"
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" plan
```

Review and apply the plan, then compare the prepared image with the actual revision:

```sh
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" apply
pnpm run admin:promote-terraform "${AERPP_ENVIRONMENT}" stage
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" plan
```

Review the traffic-promotion plan before applying it:

```sh
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" apply
pnpm run admin:promote-terraform "${AERPP_ENVIRONMENT}" accept
pnpm run admin:check-cloud "${AERPP_ENVIRONMENT}"
```

Open `console-settings.json.admin.cloudRun.serviceUrl` in a browser. Sign in with an allowed account and verify Firestore/Logging access. Confirm that an account outside the allowlist is rejected.

**Completion:** Cloud verification, actual Google login and access-control checks succeed.

## 10. Open participant admission for acceptance

Confirm that step 8's acceptance evidence matches the image and relevant configuration. Initially restrict use to the acceptance operators. Set `support.admissionOpen` to `true` and keep `maintenanceEnabled` true.

```sh
pnpm run support:prepare-deployment "${AERPP_ENVIRONMENT}" --apply
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" plan
```

After reviewing the plan:

```sh
pnpm run infra:terraform "${AERPP_ENVIRONMENT}" apply
pnpm run support:check-cloud "${AERPP_ENVIRONMENT}"
```

Opening admission fails if prerequisite evidence is missing. Return to step 8 instead of editing generated evidence. Image updates also require closing admission, verifying the new image and reopening afterward.

Use the normal Web email flow in step 11 when accepting email and Admin access exports together. The standalone test-only mail command below is an optional [transport/confirmation check](../apps/support/README.md#real-mail-acceptance): its synthetic, nondecryptable email value appears as `復号できません` in Admin exports. It must not be treated as an end-to-end participant/contact-decryption check.

For that standalone check, ensure that the configured test sender itself matches the participant email pattern and was registered as a test mailbox before deployment. After the operator explicitly selects a single real-mail send, run:

```sh
pnpm run support:check-mail test send-once
```

Open the received message in the sender's mailbox and press the confirmation button on the linked page, then run:

```sh
pnpm run support:check-mail test check
```

Require `confirmationVerified: true` and the completion message. A pending-confirmation message does not establish completion.

If delivery is uncertain, inspect the mailbox and evidence without deleting the send-once claim or automatically sending again. This automated mail command supports **test only**. For production, explicitly select the participant and one send, then verify normal email authentication through the operational-machine flow below. Review the [mail retention boundary](../apps/support/README.md#email-and-privacy) before inviting participants.

## 11. Build Web and deliver the operational bundle

```sh
pnpm run web:build-image "${AERPP_ENVIRONMENT}" <unique-image-tag> linux/arm64
pnpm run web:check-image "${AERPP_ENVIRONMENT}"
```

Use an unused image tag. The build pulls and tests ARM64 Caddy/Fluent Bit latest and records the exact image IDs. The Web check connects to the selected Support service. Export retains those tested auxiliary IDs:

```sh
pnpm run web:prepare-questionnaires "${AERPP_ENVIRONMENT}"
pnpm run web:prepare-questionnaires "${AERPP_ENVIRONMENT}" --apply
pnpm run web:prepare-documents "${AERPP_ENVIRONMENT}"
pnpm run web:prepare-documents "${AERPP_ENVIRONMENT}" --apply
pnpm run web:export-bundle "${AERPP_ENVIRONMENT}"
```

Export pins Web, Caddy and Fluent Bit image IDs/checksums and generates Compose settings; no separate `web:generate-compose` or `env:generate` command is needed for this workflow. The installer ZIP and SHA-256 sidecar are written to repository-root `distribution/test/` or `distribution/production/`. `generated/<environment>/web-bundle.json` records the output paths. Verify the ZIP and SHA-256 sidecar, then transfer the entire secret-bearing bundle through an authorized private channel. Keep it out of Git and public distribution.

On the operational machine, start Docker Desktop and LM Studio's local server with the model and endpoint recorded in the bundle's `llm-config.json`. Extract the ZIP and run from its directory. Installation loads images, installs files and performs model readiness checks in a temporary container; application services are started separately:

```sh
bash ./install.sh
```

The default installation directory is `$HOME/aerpp`; pass another absolute path to `install.sh` if needed. Installation places `operate.sh` there and already checks bundle integrity and local model readiness. A separate `operate.sh verify` is an optional later checksum diagnostic, not a required installation step. After successful installation or update, the extracted ZIP folder can be deleted. For an update, run the installed operator with `update /absolute/path/to/new-bundle --maintenance`.

With LM Studio still running, start the application separately:

```sh
bash "$HOME/aerpp/operate.sh" start
```

If verification fails, inspect Docker, LM Studio and connectivity. Do not change model settings merely to make the check pass. Open `http://localhost/` and verify page rendering, email authentication, consent, local LLM analysis, questionnaires and withdrawal on the operational machine. Explicitly select recipients and send counts for real-mail checks. Test and production use the same default ports and therefore require separate hosts.

**Completion:** Operational verification and the participant flow succeed. Confirm that documents/results stay out of cloud services and sensitive data stays out of Cloud Logging. Inspect both application and platform logs for token exposure.

## 12. Accept the environment and operate it

Use the [local prerequisites](development.md#first-run-without-cloud-credentials) on the build machine, including the emulator JAR. For **test acceptance**, run:

```sh
pnpm run verify:local
```

Complete cloud, OAuth, mail and operational-machine acceptance for test. Repeat the applicable procedure with independently configured production inputs before production use.

For **production release acceptance**, run the following after production deployment and Web bundle evidence are available. It already includes the local verification suite plus release readiness and dependency audit; running `verify:local` immediately beforehand is unnecessary. It checks production regardless of the shell's selected environment variable.

```sh
pnpm run verify:release
```

Resolve missing settings, delivery evidence or checks before retrying. Test results do not replace production acceptance.

The responsible operator records the results before inviting general participants. A generated URL, successful configuration validation or checked image alone does not establish readiness. Record mail delivery, Admin OAuth, Scheduler and operational-machine acceptance separately.

Follow [bundle operations](../infra/README.md#immutable-private-bundle-operations) for updates, shutdown and recovery. Finish active analyses before updating. Preserve the installation directory, session key and `web-session-coordination` volume. Backup restoration must not reintroduce withdrawn data.

After changing settings, refresh Console materials with `pnpm run env:sync "${AERPP_ENVIRONMENT}" --refresh`. Updating generated files alone does not change a running service. Complete the required prepare → plan → review → apply → verify sequence.

References: [Configuration](configuration.md), [Environments](environments.md), [Deployment and recovery](deployment.md).
