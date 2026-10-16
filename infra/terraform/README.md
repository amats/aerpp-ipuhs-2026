# Cloud infrastructure

This Terraform root owns Support/Admin repositories, runtime identities, the keyless local Admin identity and on-premises logging identity, secret containers and scoped IAM, the default Firestore database and indexes/field policies, Support/Admin Cloud Run services, Support Scheduler jobs and monitoring. Resource addresses already present in state remain stable. Secret values never enter Terraform; preparation uploads local authoritative secrets and projects only immutable image digests and numeric version references.

Terraform and the Google provider are pinned in versions.tf and .terraform.lock.hcl. The wrapper also recognizes private/tools/terraform/terraform. Use the pinned executable and retain the provider lockfile.

## Environment isolation

Each private configuration owns top-level projectId, infrastructure.operatorAccount and infrastructure.region. Test and production have separate state buckets named from their environment and project number, and separate local TF_DATA_DIR directories. Terraform uses the selected operator's existing gcloud login; no separate ADC login, OAuth client or service-account key is created. Do not copy state, auto.json or deployment records between environments.

The wrapper supplies both backend and provider authentication through a private, process-scoped OAuth refresh adapter. A worker listens only on loopback, requires a random capability and retrieves short-lived tokens through gcloud with the bound project/operator. Tokens stay in memory; the generated connection configuration contains no Google refresh token or private key and is removed when the command ends. This keeps long serial Firestore applies authenticated without relying on a single [nonrenewable provider access token](https://registry.terraform.io/providers/hashicorp/google/8.3.0/docs/guides/provider_reference#authentication-configuration). Ambient ADC and global account selection are not used.

```sh
pnpm run cloud:inventory test asia-northeast1
pnpm run infra:terraform test bootstrap
pnpm run infra:terraform test plan
# Review generated/test/support-terraform/plan.json.
pnpm run infra:terraform test apply
```

Use production explicitly only after its independently supplied settings are ready. Enable required APIs and confirm billing/location first. bootstrap creates or verifies a versioned GCS bucket with uniform access and public access prevention. An existing bucket without matching private ownership evidence is rejected. The bucket stays outside its own state.

## Plans and ownership

The wrapper binds saved plan bytes to inputs, HCL/template sources and provider lock. Replan after any change. It rejects target mismatches, unknown resources, deletes/replacements and unsupported updates. Retired Support uptime resources are outside the maintained plan allowlist; notification channels and error alerts remain protected. Database/index creation is allowed for a new environment; existing persistent objects must remain unchanged. Do not use destructive recreation to handle an ownership collision.

Applied output is validated before writing auto.json.terraform.support. A planned deterministic service URL is not deployment evidence. If local output projection fails after apply, retry outputs with unchanged inputs. Use a fresh plan to detect live drift.

Applies run with one resource operation at a time because Firestore wildcard policies and individual field overrides share collection metadata and can otherwise return HTTP 409 contention. After a partial failure, inspect live resources and saved state, then review a fresh plan for the remaining changes; do not repeat the old saved plan or recreate completed resources.

The initial foundation can create Admin infrastructure without an image; accepted image and numeric secret-version references are supplied by admin:prepare-terraform. Independent application-key versions can be initialized earlier through the setup helper below. Existing Admin traffic remains pinned during revision preparation and is promoted separately. Support image updates require closed admission; reopening requires same-image data/Scheduler acceptance. See [deployment](../../docs/deployment.md).

For a new project, [setup step 3](../../docs/setup.md#3-provision-the-terraform-foundation) composes API/backend preparation and the reviewed foundation apply before manual OAuth and Logging input. It uses the supported missing-Logging placeholder. Without prepared deployment manifests, Terraform creates secret containers and identities without secret versions, Cloud Run services or Scheduler jobs. The setup helper follows apply with Console regeneration and application-key preparation; it uploads three Admin secret versions outside Terraform. Complete manual credentials before all-app validation or application delivery. [Environment construction](../../docs/environment-construction.md) explains the required state for independent construction.

The `infra:terraform` command coordinates focused modules under [scripts/infra/terraform](../../scripts/infra/terraform/execute.mjs): accepted input projection, backend ownership, authenticated execution, saved-plan provenance and applied-output projection. Resource-family guards are composed by [plan-policy.mjs](../../scripts/infra/terraform/plan-policy.mjs). The [script hierarchy](../../scripts/README.md#composition-and-operation-layers) keeps these operations separate from the initial setup workflow.

### Recovery after external policy deletion

Use these exceptional operations only for an explicitly selected reconstruction after infrastructure policies have been externally removed. They do not restore deleted documents. Keep the backend, state generation, credentials and database/backup protections intact. Prepare the current Support image with `support.admissionOpen: false` and matching Admin settings first.

```sh
pnpm run infra:terraform test close-admission-plan
```

Review `generated/test/support-terraform/close-admission/plan.json`; only the prepared closed Support service may change. Apply and verify it before field recovery:

```sh
pnpm run infra:terraform test close-admission-apply
pnpm run support:check-cloud test
pnpm run infra:terraform test recover-fields-plan
```

Review `generated/test/support-terraform/recover-fields/plan.json`, then run:

```sh
pnpm run infra:terraform test recover-fields-apply
pnpm run infra:terraform test plan
```

Field recovery checks the actual closed Support revision before both planning and applying. It may create maintained field/index definitions and re-enable externally removed TTL on `emailConfirmations/expireAt`, `information/expireAt` and `supportRateLimits/expireAt` without changing indexes or identity. Ordinary plans still reject field updates. Recovery rejects deletions, database/backup changes and all unrelated mutations, and writes separate provenance and evidence. Rerun the full foundation plan after recovery; targeted recovery does not establish complete deployment readiness. Substitute `production` only for a separately authorized production reconstruction.

Repository cleanup retains the latest generation plus live/prepared image pins. The wrapper generates `image_retention_pins` from the selected project's Cloud Run state and prepared deployment metadata; do not supply it manually. Every plan validates the exact deletion/KEEP conditions. After promotion, review/apply another plan to release obsolete pins. Cleanup cannot delete tagged Admin images while immutable tags are enabled, so tags are mutable while deployment references remain immutable digests. See [image retention](../../docs/deployment.md#image-retention) for the grace period, local cleanup and recovery limits.

## Persistence and maintenance

[Daily Firestore backups](https://registry.terraform.io/providers/hashicorp/google/8.3.0/docs/resources/firestore_backup_schedule) are opt-in through infrastructure.firestore.automaticBackups and an explicit backupRetentionDays (1-98). Terraform creates the schedule after the database, with PREVENT deletion policy and prevent_destroy. The plan guard accepts only creation or no-op for the selected database, project and retention; changes to an existing schedule need a separately reviewed policy change. Disabled configurations create no schedule. Verify completed backups and restoration independently.

Database location is immutable. prevent_destroy and deletion_policy=ABANDON protect this workflow; they do not create backups or prevent deletion through other tools. Existing test data, consent/withdrawal history and indexes must remain intact.

Support has datastore.user; Admin and its separate local identity have datastore.user for information management plus the existing datastore.viewer/logging.viewer grants. The redundant viewer grant is retained to preserve existing protected IAM resources. Firestore write IAM is database-wide; the Admin application limits mutations to information. The selected operator receives tokenCreator only on the local Admin identity. Logging has logging.logWriter. Service-account identities and IAM are Terraform-owned; service-account keys are never placed in Terraform state. On-premises Logging reuses the operator-supplied key from secret.json; runtime files are generated. Support rate-limit counters have their own TTL. Participant state is not TTL-deleted. Maintenance uses two OIDC-authenticated Scheduler jobs with exact route audiences, one for bounded withdrawal cleanup and one for Gmail token health. Token health sends no mail.

Support uses request-based billing with explicit cpu_idle=true and zero minimum instances in both environments. Complete maintenance work before returning the HTTP response; pending cleanup resumes on a later request. The plan guard permits changing cpu_idle from false to true while preserving resource limits and other service settings. This requires a fresh reviewed plan/apply; editing the Terraform source does not update the deployed service.

Support's HTTP startup probe checks `/health` every second with a one-second timeout and a failure threshold of 30, retaining a thirty-second startup budget. This detects the listening server promptly while allowing cold starts; it does not check Firestore or Gmail connectivity. The plan guard permits the transition from ten-second checks with three failures while preserving the endpoint and other probe/service settings. Apply a fresh reviewed plan in each selected environment and compare application-ready and startup-probe-success logs to verify the actual startup latency.

## Monitoring and acceptance

Cloud Scheduler dispatches remain configured while maintenance is enabled. Support performs data/Gmail work only from twelve hours before access starts until the independent Support backend stop and records a successful skip outside that window. Scheduler checks distinguish completed work from this skip; skipped requests cannot satisfy the admission gate. See the [maintenance window](../../docs/configuration.md#scheduled-maintenance-window).

Configure infrastructure.monitoring.notificationEmail independently from Gmail sender and Admin login. Error/maintenance-failure alerts and notification channels are managed here. Periodic HTTPS uptime checks and their availability alerts are retired in both test and production; `/health` remains available for explicit deployment checks. Cloud Monitoring remains enabled for error notifications. Cloud/data/Scheduler checks verify different boundaries. A matching notification test log does not prove receipt. Do not automatically repeat a claimed notification or mail test.

Run these commands from the workspace root with the selected `test` or `production` environment:

| Command | Effect and evidence |
| --- | --- |
| `pnpm run support:check-monitoring <environment> check` | Validate the unique explicitly enabled email channel, selected project references, exact linked error log condition and notification timing, then write private `support-monitoring-check.json`; no notification is sent. |
| `pnpm run support:check-monitoring <environment> diagnose` | Read configuration, incidents, snoozes and recent matching logs; save private diagnostic evidence without sending a test notification. |
| `pnpm run support:check-monitoring <environment> notify-once` | After an explicitly selected notification test, claim it and write one synthetic ERROR log to trigger the configured alert policy. This is a cloud write and may send an operator notification; it does not use the participant Gmail sender. |

The shared [Support error filter](support-error-filter.tftpl) is rendered by Terraform and compared by the acceptance script. Cloud Run ownership uses the `aerpp-component` revision label, not service names; apply the Support revision-label addition with a fresh reviewed plan and verify the serving revision before relying on these queries. Support and Admin cloud acceptance commands require the matching component and environment revision labels. Existing unlabeled revisions and their historical logs are outside the new component scope. Expected application codes (`ADMISSION_CLOSED`, `WITHDRAWAL_CLEANUP_PENDING`) remain excluded from application-log alerts. Platform request 5xx remains eligible on every route, including 503: request logs do not carry response-body codes, so an expected application 503 may also produce an operator alert. Inspect the matching application record before classifying it as an outage. Never suppress an entire route's 503 responses because that also hides platform failures.

Confirm receipt in the configured operator mailbox and record the result privately. The script always leaves `notificationReceiptVerified: false` because it cannot inspect the mailbox; do not hand-edit generated evidence. If receipt is uncertain, use `diagnose` and inspect the mailbox instead of deleting `support-alert-test-claim.json` or repeating `notify-once`. The claim prevents automatic repetition, not a guarantee that Cloud Monitoring delivered exactly one message. Neither the admission gate nor `verify:release` verifies mailbox receipt.

## Recovery

Keep GCS state locking and object versioning. Inspect live resources and preserve the current state before restoring any generation. State recovery does not restore Firestore data. Recover only maintained compatible application versions; retired infrastructure is not retained for rollback.

If Terraform reports that it could not persist state and writes `errored.tfstate`, do not replan or repeat apply first. Move that file out of the source directory into the selected private Terraform directory without changing its contents. Confirm that the failed process has exited, inspect the selected backend's lock, and compare the remote and recovered lineage/serial. Restore the newer matching state through [Terraform state push](https://developer.hashicorp.com/terraform/cli/commands/state/push), preserving locking; never force an unrelated lineage or overwrite a newer state. GCS lock IDs are object generations, not the UUID inside the lock JSON. Release only a verified stale lock from the exited operation. Check for cloud operations that completed without being recorded; adopt a resource only after its project, identity and complete definition match the reviewed plan. Then create and review a fresh plan. Retain recovery evidence until the restored state and final no-change plan have been verified.

## Questionnaire archive

Terraform creates `${projectId}-questionnaires` in the selected project and region, with uniform bucket access, public access prevention, object versioning and bucket destruction protection. There is no age-based deletion policy: retain referenced definitions independently of image and secret cleanup. Operators receive object creation and viewing permissions; hosted and local Admin receive viewing only. Broader preexisting IAM grants remain outside these bucket grants. Web runtime and Support need no archive credentials. Apply this foundation before the explicit [questionnaire registration step](../../docs/deployment.md#web-images-and-operational-bundles). Registration does not prove that hosted Admin can read: verify research ZIP access separately in the authorized project.

Admin requests allow 120 seconds to accommodate research ZIP retrieval. The plan guard permits extending the previous 60-second limit to 120 seconds while preserving the other service settings apart from the already permitted deployment changes. Apply a fresh reviewed plan to update an existing service; local source changes do not extend its deployed timeout. See [export retrieval limits](../../apps/admin/docs/data-export.md#research-fields).

## Document archive

The private, versioned document bucket retains exact MDX/PDF originals and manifests independently of Firestore and image cleanup. Operator IAM is create/view only; Support and local/hosted Admin have read-only access. Terraform prevents destruction and has no object deletion lifecycle. The plan guard permits only reviewed creation or no-op with the selected project, region and identities. Apply this foundation before [document registration](../../docs/document-sets.md#archive-and-delivery); participant withdrawal never deletes originals.
