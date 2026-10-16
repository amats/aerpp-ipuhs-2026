# Deployment and recovery

The maintained system consists of on-premises Web/local LLM, Cloud Run Support and Cloud Run Admin, with Firestore, Gmail and Scheduler. Terraform owns cloud infrastructure.

Every installation requires its own test and production acceptance, with independently supplied account, sender, OAuth and secret configuration. Closed cloud deployment, admission activation and operational acceptance are separate stages. This document defines the supported procedure, not evidence of readiness for a clone. The [intended environment](environments.md#intended-environment) defines the development, operational Mac and cloud roles.

## Current entrypoints and boundaries

Build Docker images locally. Keep images, bundles and generated runtime settings private. GitHub publication distributes source only, using [source release and publish guidance](releases.md). Local/emulator/container checks, cloud acceptance and operational-machine acceptance are distinct.

Every cloud command requires an explicit test or production target. Its project/operator come from the private configuration. Backend state, generated outputs, images and secret versions are isolated by environment. Test development must not change production settings or running services. See [environments](environments.md).

Image checks and archive extraction remove local temporary settings and extracted files even when Docker container removal fails. The command still reports the Docker cleanup failure.

## Infrastructure and Support delivery

1. Supply the selected private infrastructure configuration and authenticate its operator account. Enable the required APIs and confirm Firestore location.
2. Run `pnpm run infra:terraform test bootstrap`, then plan. Review private plan.json and apply. Substitute production only for an explicitly selected production operation. Foundation resources can be prepared before application credentials/images.
3. Supply the selected Support secrets and Gmail settings; keep admission closed. Build with support:build-image <environment>, then run support:check-image <environment>.
4. Run support:prepare-deployment <environment> --apply to push the checked image and reuse an unchanged enabled runtime-secret version or upload one new immutable version, then prune unprotected old secret versions. This does not generate/rotate source secrets. A partial upload can leave unused versions; inspect evidence before retrying.
5. Run infra:terraform <environment> plan, review and apply. Verify the exact image, secret version and serving revision with support:check-cloud <environment>.
6. Enable maintenance in the selected configuration, prepare/apply its runtime change and run support:check-data and support:check-scheduler <environment> run, then check after execution logs arrive. Require completed HTTP 200 from Scheduler and the accepted service revision. Maintenance performs work only from twelve hours before access starts until the independent Support backend stop. Outside that window, authenticated Scheduler requests return HTTP 200 with a recorded skip before Firestore/Gmail access. Scheduler invocation continues; it does not imply work was performed. Acceptance records distinguish completion from a skip, which cannot authorize admission. No mail is sent by those jobs.
7. Enable admission only with accepted data/Scheduler evidence for the same image. Recipients must match the selected Web participant email pattern. The real-mail acceptance command sends only to the configured sender, which must match that pattern. Real mail tests require explicit invocation and preserve a send-once claim; ambiguous sends must not be repeated automatically.

Project only explicit non-secret infrastructure inputs and immutable deployment references. Serialize metadata writers within the selected environment, and preserve source/plan fingerprint checks, target guards and persistent-resource protections.

On an image update, close admission, prepare/apply the new image, verify it and only then reopen. Preserve participant identity, consent, withdrawal history and active Web sessions. See [Terraform](../infra/terraform/README.md) for plan constraints and state handling.

Complete [operator notification acceptance](../infra/terraform/README.md#monitoring-and-acceptance) separately. The data/Scheduler admission gate does not verify notification receipt.

## Gmail reauthorization

For `MAIL_REAUTHORIZATION_REQUIRED`, repeat the operator consent steps in [Gmail setup](setup.md#obtain-the-gmail-refresh-token). Preserve the intended sender and client unless explicitly changing them. Save the operator-provided refresh token in the selected private `secret.json`; do not automatically generate or rotate credentials or retrieve existing Secret Manager values.

Run the selected [token health check](../apps/support/README.md#gmail-token-health-check), then use the Support preparation and reviewed Terraform deployment procedure above to upload a new runtime-secret version and activate it in a new revision. Local secret changes and a successful local token refresh do not update the deployed service. Verify the exact runtime version and serving revision, then its scheduled token health. Keep alert delivery independent of the failing sender. Any real-mail verification remains an explicitly selected operation with its send-once claim preserved.

## Admin Cloud Run delivery

Admin and Support image builds use eight concurrent registry requests and a three-minute package fetch timeout so large locked dependencies can download on slower build hosts. Terraform's Admin runtime allowlist must match the current hosted projection; Admin images contain no questionnaire definitions; only research ZIP requests read the selected project’s questionnaire archive. Explicit Admin document verification/reissue reads the separate document archive.

Terraform creates the Admin repository, runtime identity, secret containers/IAM and service. Build the selected image with admin:build-image and check it with admin:check-image. `pnpm run admin:prepare-terraform <environment>` pushes the checked image, reuses unchanged enabled secret versions or uploads changed values, and prunes unprotected old versions without imperatively changing the service.

Environment refresh and preparation verify ownership through the revision-template component and environment labels managed by Terraform. Optional service-level ownership labels must agree; missing template ownership or conflicting labels stop refresh and preparation.

Review/apply infra:terraform for the selected environment. An existing deployment keeps traffic pinned until the new revision passes checks. Run admin:promote-terraform <environment> stage, review/apply the traffic plan, then admin:promote-terraform <environment> accept and admin:check-cloud <environment>. Initial creation uses the first ready revision; run the same checks before acceptance.

Confirm actual Google login, allowlist enforcement and Firestore/logging access separately. On-premises and hosted credentials are separate. Production must use its own OAuth account/client settings. Web distribution images require the private MDX/PDF set in `apps/web/assets/`, including test images; Web questionnaire sources are shared across environments through `config/common/survey/`.

Admin contact exports require the existing Web `SESSION_SEAL_PASSWORD` and `IDENTIFIER_HASH_SECRET` as Admin secrets. The Admin foundation owns their `${service}-email-seal` and `${service}-identifier-hash` containers and runtime IAM; preparation uploads the selected private values and pins their numeric versions. Apply the foundation before preparing the updated Admin revision, then apply/promote it through the normal workflow. Do not rotate either key or place their values in Terraform inputs/state.

## Secret version retention

Test and production use the same policy independently: keep the latest non-destroyed version of each managed Admin session/OAuth/email-seal/identifier-hash secret and Support runtime secret, plus every live, prepared or explicitly recoverable reference. This is one latest generation, not one extra historical generation. Disabled old versions are also destroyed because disabling does not stop storage charges. Secret containers and unrelated secrets are preserved.

Admin/Support preparation records a private SHA-256 receipt immediately after a successful upload, before later deployment steps. Subsequent preparations reuse the same numeric version only when the exact local bytes match and cloud metadata confirms the same enabled version and creation time. Receipts live in `generated/<environment>/secret-version-*.json`; never edit or publish them. No cloud secret values are downloaded. Missing receipts require one upload to establish equality; failed uploads and missing/disabled/destroyed versions are not reused. A failure after cloud upload but before receipt persistence can leave an extra version for later cleanup.

Preparation automatically prunes its own component after saving the new immutable deployment references. A successful `infra:terraform <environment> apply` also prunes Support secrets when a Support deployment exists, and `admin:promote-terraform <environment> accept` prunes Admin secrets after recording promotion. A cleanup failure does not undo a completed deployment; inspect the saved evidence and retry cleanup, not deployment. After cloud verification/promotion, run `pnpm run cloud:secrets test` (or `production`) to preview remaining cleanup and add `--apply` to destroy eligible versions. The command refreshes Cloud Run traffic/tag, latest created/ready revision and service-template references, current prepared/deployed manifests, Support admission baseline and active recovery selection before each destruction. Unavailable protected versions, aliases such as `latest`, incomplete metadata or changed protection stop cleanup. Explicit recovery references can retain more than one version; historical revision records alone are not supported rollback targets.

Run preparation, recovery selection, Terraform deployment/promotion and cleanup serially within each environment. Managed secrets are exclusive to the maintained services in that configuration's region; do not add unmanaged consumers. Cleanup does not deploy or change traffic. Destruction is irreversible and has no preparation grace period; latest and prepared references provide protection. Progress is written to `generated/<environment>/secret-retention.json`; inspect it after partial failure before rerunning. The operator needs secret version get/list/add/destroy permissions; runtime identities do not receive management permissions.

## Image retention

Each managed Artifact Registry repository retains the latest version per package. Terraform deletes older versions after a 24-hour preparation grace period; Artifact Registry runs cleanup asynchronously, so this is not an immediate one-file limit. A Docker image can include an index, a platform manifest and an attestation.

For immediate cleanup of eligible old generations, preview `pnpm run cloud:images test` (or `production`), then use `--apply`. This checks live/prepared pins again, preserves complete index/platform/attestation families and removes old parents before children. It preserves the same 24-hour preparation grace and writes private deletion evidence. Run it serially with deployment operations.

After cloud verification and promotion are complete, `cloud:images <environment> --finalize` previews cleanup without the preparation grace; add `--apply` to execute it. Finalization requires matching current Admin/Support cloud evidence and no staged Admin image. Live references remain protected. Use it only after all selected-environment pushes and deployments have finished.

The infrastructure wrapper reads live Cloud Run revisions at both plan and apply. It additionally protects all traffic/tag targets from both desired service configuration and observed status, latest created/ready revisions, the latest ready generation and the selected prepared image. Image and secret retention share the traffic-target validation; incomplete service metadata or unresolved targets stop cleanup. A changed service-template repository cannot hide its still-serving managed images. Missing or cross-repository digests fail closed. KEEP conditions use the first 64 characters of the digest name to respect the API prefix limit. Admin tags are mutable to permit garbage collection, but delivery still creates unique tags and pins exact SHA-256 digests. Never overwrite a published delivery tag.

After a traffic promotion or image replacement, run another reviewed `infra:terraform <environment> plan` and `apply` to retire the old protection pins. Preserve pins throughout a staged deployment. Do not deploy through another tool without refreshing protection before the cleanup worker can run. Historical Cloud Run revisions outside this policy are not supported rollback targets.

On this build host, `pnpm run private:images` previews old managed images; `pnpm run private:images --apply` removes them and trims unused cache on the selected Buildx builder toward 5 GB (1 GB reserved). Each successful application image build also runs this local maintenance. Keep one generation per application/environment, plus images referenced by current build/deployment/export evidence or any container, including stopped containers. Unrelated images and Docker volumes are preserved. Unlabelled dangling images are left for explicit review. Shared image layers and active cache can keep reported Docker totals above the cache target. Run builds and maintenance serially; this command does not configure other builders or remote operational hosts.

## Web images and operational bundles

Use web:build-image <environment> and web:check-image <environment> with the private `apps/web/assets/` MDX/PDF set and the shared questionnaire JSON from `config/common/survey/`. Local development/builds can use the same private documents. Docker receives only the eight required document files through a separate named build context. Each build refreshes Caddy/Fluent Bit latest and checks their exact IDs with configuration and isolated local traffic tests; export retains those tested IDs. Build-setting, asset or infrastructure-configuration drift requires rebuilding/checking. These tests do not prove Cloud Logging delivery. After image checks, run `pnpm run web:prepare-questionnaires <environment>` to inspect the exact image definitions, then add `--apply` to register and verify them in the selected project. Terraform must first create the questionnaire bucket and Admin/operator IAM. Registration uses the private configuration’s project/operator and writes only questionnaire JSON, without runtime credentials inside Docker. A failed or mismatched registration blocks bundle export; rerun registration safely after correcting the cause. Also inspect `pnpm run web:prepare-documents <environment>` and, when cloud registration is authorized, add `--apply` to register the exact image’s PDF/MDX set. The document bucket and operator/Support/Admin IAM must already exist. Bundle export requires both registration receipts; see [document identity and retries](document-sets.md). Export through web:export-bundle, which generates the required Compose inputs itself; web:generate-compose is available for a separate configuration diagnostic. See [setup step 11](setup.md#11-build-web-and-deliver-the-operational-bundle) for the command sequence. The operational machine imports the private bundle and uses Docker/Compose plus local LM Studio; it does not install source dependencies or build images.

Preserve the web-session-coordination volume and matching session key across updates. Retain current participant collections and sessions. Current-schema authority is retained indefinitely; missing state is not reconstructed. Follow [coordinated updates](study-operations.md#coordinated-updates). Keep matching Support/Web/Admin versions and preserve research facts created by the new workflow. Independent multi-host replicas cannot coordinate participant authority. Run one Web Node process: transient analysis prompts/results are not shared across processes. Browser reload resumes inference, but restarting or replacing Web loses pending RAM content. Allow active analyses and result acknowledgements to finish before a planned replacement; unverifiable execution ownership or lost presented initial results awaiting their questionnaire require researcher recovery. Durable completion or demonstrably dead Linux execution ownership permits acknowledged output-loss recovery, including follow-up output after presentation, preserving earlier attempts/timing and never automatically inferring again. Deploy matching Support and contracts with Web; require acknowledgement of the loss observation before clearing local work. Keep model settings unchanged unless explicitly authorized. Follow [operational infra](../infra/README.md).

Questionnaire replacements require stopping operation, rebuilding/checking Web and registering its canonical definitions before exporting and restarting. Admin content updates require no rebuild. Image replacement does not clear browser results or pending answers; mismatched forms are rejected and need explicit recovery. Follow the [questionnaire replacement procedure](examples.md#questionnaire-definitions). Archive retention is independent of image/secret cleanup; preserve all referenced definitions.

## Maintenance and backup boundaries

Scheduled Support work runs only within the [maintenance window](configuration.md#scheduled-maintenance-window), without extending participant authorization. An authenticated skipped HTTP 200 is not completed maintenance or admission evidence. Unfinished cleanup after the backend stop remains durable for operator recovery.

[Firestore backup policy](configuration.md#firestore-automatic-backups) is selected independently in each configuration. Creating a schedule does not establish completed-backup or restoration evidence; preserve the schedule deletion/replacement guards.

## Shared-package and version gates

Workspace version ownership, changelog sections and public tags follow the [single-version source release policy](releases.md#single-workspace-version). A published source version does not establish that any installation has deployed or accepted it.

Use one root pnpm lockfile. Build artifacts must include their required workspace dependencies, notices and fonts without private source/configuration. Request schemas are owned by packages/contracts/src/request-schemas.ts; synchronize the generated TypeScript block and validate OpenAPI before deployment. Keep Web/Support payload behavior and persistence invariants aligned. Deploy matching participation contracts with Support, Web and Admin. Completion metadata requires the captured analysis workspace version, rejects top-level `surveyVersion` and compares every field on retry. Operational history is read from `analysisRuns` and `accessEvents`; no research-record fallback or duplicate withdrawal receipt is provided. Ordinary deployment preserves attempts, receipts and study eligibility. Review stored schemas and retained state through [coordinated updates](study-operations.md#coordinated-updates); database initialization is a separately authorized operation.

## Source identity and dependency acceptance

Build application images from committed source with a clean Git worktree. Builds
record `sourceRevision`, `sourceTree` and `sourceDirty: false`, check the source
again after building, and bind the image ID to revision/tree labels. Image checks
require the same current source and copy its identity into acceptance records.
Admin/Support preparation and Web bundle export preserve this identity alongside
immutable image IDs and registry digests. Missing/dirty/mismatched source evidence
requires rebuilding through the owning commands; never repair generated JSON by
hand. Runtime/configuration and private research-asset fingerprints remain separate.

`verify:release` checks production delivery evidence against the current source,
runs the local gates, builds, browser suites and `audit:release`, then confirms the
source did not change during verification. All three applications and their checks,
deployments and Web bundle must name the same tested revision/tree. This does not
replace real serving-revision or operational-machine acceptance.

`audit:release` runs the full production audit and permits only the reviewed
[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
finding for `sprintf-js@1.0.3` on `apps__web>mammoth>argparse>sprintf-js`, at moderate
severity and without an available patch. Mammoth's `bin/mammoth` CLI imports
`argparse`; the browser document-import path uses Mammoth's browser API instead.
The operator accepts release with this limited finding. Recheck upstream fixes and
reachability before publication and whenever the dependency path changes. Different
findings, paths, versions, severity, patch availability and audit errors fail the
gate. `pnpm audit --prod` remains an unfiltered diagnostic and reports this finding.

## Release acceptance

Run root verify:release for application production acceptance, including local checks, production configuration/readiness checks, builds, browser tests and dependency audit. [Source releases](releases.md#source-verification) use verify:publication plus source builds/browser checks independently. A local passing check does not establish production rollout, real Gmail delivery, OAuth acceptance or operational-machine success. Record those outcomes against the actual selected deployment.

`release:check` compares current projected Web settings with the exported bundle's runtime fingerprint and current hosted Admin settings, including supplied secrets, with the accepted deployment's runtime fingerprint. Local Admin operator settings are excluded by the hosted projection. It also compares current Web build settings, research assets, questionnaires and all bundled LLM preset JSON contents with the checked/exported image fingerprint. Changed or missing fingerprints reject readiness. Regenerate Admin evidence through preparation and acceptance in the selected-configuration Terraform workflow; regenerate Web evidence through image build/check and bundle export. Never edit generated JSON to repair evidence. Fingerprints contain hashes only; no secret values are fetched from Secret Manager. This recorded comparison does not inspect live services or prove operational installation.

## Recovery

Recover only to a compatible maintained application/runtime revision. A traffic or configuration change does not undo Firestore writes or sent email. Never restore withdrawn records or overwrite accepted records with a stale snapshot. Preserve the current Terraform state generation and compare real resources before state recovery. Keep locking and backend versioning enabled.

For Support's narrowly scoped runtime-version recovery, `pnpm run support:select-recovery <environment> select` selects the numeric secret version from the saved admission baseline only when project, image and exact runtime hash match. It requires closed admission and enabled maintenance in the selected configuration. `restore` returns the local deployment selection to its recorded original value. Both modes change private selection metadata only; a new reviewed Terraform plan/apply and cloud acceptance are still required. This is not a general image rollback or a way to bypass missing acceptance evidence. Preserve the selection record for retention protection.

The selected private configuration owns the [Firestore backup policy](configuration.md#firestore-automatic-backups); configured backups alone do not establish restoration readiness. Recovery targets must meet the maintained application and infrastructure contracts.

## Reconstructing deleted Firestore policies

After an explicitly authorized external removal of indexes or TTL policies, use the reviewed [field recovery operation](../infra/terraform/README.md#recovery-after-external-policy-deletion) to reconstruct maintained definitions before the full deployment plan. This restores infrastructure policies only, never deleted documents. Keep matching applications and contracts, Terraform state and database/backup protections. Databases must use the maintained schema; policy recovery does not migrate their records. Local tests/builds do not establish cloud index readiness or serving-revision agreement.
