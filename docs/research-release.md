# Research release records

## Public study and source release

The evaluation study, *Evaluation of an AI System for Pre-analysis of Research
Ethics Application Documents*, is preregistered on OSF. The following records link
the public study registration and its associated source release:

| Record | Value |
| --- | --- |
| Study preregistration | [10.17605/OSF.IO/MJDEQ](https://doi.org/10.17605/OSF.IO/MJDEQ) |
| Public repository | [amats/aerpp-ipuhs-2026](https://github.com/amats/aerpp-ipuhs-2026) |
| Software version | `1.0.0` |
| Release tag | [v1.0.0](https://github.com/amats/aerpp-ipuhs-2026/releases/tag/v1.0.0) |
| Source commit | [`7227b26044447f0204cfd6e7f641838a675a1176`](https://github.com/amats/aerpp-ipuhs-2026/commit/7227b26044447f0204cfd6e7f641838a675a1176) |
| Software release date | `2026-10-16` |
| Software citation metadata | [CITATION.cff](../CITATION.cff) |

The OSF DOI identifies the study preregistration. Use the software citation metadata
for the source release and cite the registration when discussing the study or its
protocol; the [README](../README.md#study-preregistration-and-citation) provides the
registration citation. The software is covered by the [MIT license](../LICENSE);
the registration's [DOI metadata](https://api.datacite.org/dois/10.17605/osf.io/mjdeq)
list CC BY 4.0 for the registration.

Reconcile this source identity with the registration's protocol and attachments
when recording study provenance. Retain the actual deployment and local inference
conditions under [release provenance](#release-provenance).

The citation metadata were added after the `v1.0.0` release and describe that fixed
snapshot. They are available on the default branch; the existing tag and its source
archives retain their original contents. Preserve this historical mapping when
documenting later source releases under the [source release procedure](releases.md).

## Study-period change policy

From the participant study release through the end of the approximately one-year study, keep application behavior fixed, including algorithms, resource limits, UI/research wording, questionnaires, prompts, model selection, generation settings and stored data semantics. Complete required design changes and validation before this freeze. The exception is minimum necessary security maintenance, including dependency updates; this is not permission for incidental feature or research-condition changes.

For a security update, record the reason, exact dependency/image changes and verification of unchanged study behavior. Auxiliary images refreshed during a Web build are part of the reviewed change as well. Retain release provenance and follow the existing release gate. Do not change models, generation settings or prompts during measurement or maintenance without explicit study-owner instructions.

Reception dates may need adjustment during the study. Change the private configuration during planned maintenance, then recompile and deploy matching applications through the [existing configuration procedure](configuration.md#support-editable-configuration). This is an operational setting exception without changes to research conditions; no Admin date editor is planned. The implemented [session/cutoff separation](study-operations.md#participant-session-lifetime) keeps confirmed participant sessions without application expiry, while email confirmation links remain time-limited.

Plan for 20–40 participants, normally fewer than ten simultaneous users, and validate approximately double that scale before release. Arrivals are expected to be distributed. Assess cumulative session allocation, retries, input/output bounds, model latency, credential validity and storage/retention over the whole period; do not equate participant count with browser-session or analysis-job counts. Current constraints and required acceptance are listed in [study operations](study-operations.md#capacity-and-pre-release-verification). Numeric changes require a separate implementation task.

The [data inventory](data-handling.md) owns storage locations, encryption/hash locations and retained copies. Consent email ciphertext and sensitive Admin access-management exports are intentional. Never introduce server/cloud document or result persistence to support study recovery.

At study end, remove the operational Web server and its DB. Extract and verify the required research/management data using Admin before deleting the cloud project. Follow the [closure specification](study-operations.md#study-closure-and-deletion); maintenance restarts during the study must instead preserve the DB, keys and valid sessions.

## Release provenance

Participant collection follows the [current record definitions](architecture.md#analysis-and-questionnaire-records): initial use requires analysis and the initial questionnaire; attempt observations and submitted answers are distinct. Renewed participation uses existing consent/withdrawal history, without an additional episode identifier. Missing terminal observations and withdrawn records limit retrospective denominators. Admin counts are temporary, simplified operational displays; accurate research aggregation requires exporting the source data, selecting the appropriate records and analyzing that selection separately. Record the selection criteria in the study's analysis records.

Every initial and follow-up completed analysis stores `analysisWorkspaceVersion`, captured when Web reserves the analysis job and preserved through completion receipts, questionnaire submission, exact retries and administrator recovery. Research exports include it alongside the existing `analysisId` linkage and questionnaire definition reference; no separate questionnaire-screen version is collected. Support rejects completion requests missing the field. Admin displays the recorded analysis version without substituting its own version.

Fix each deployed workspace version to one GitHub source tag/commit and distribute that exact code. Update the workspace version for each delivered source update, including security maintenance, so retained analysis records resolve to the code and prompt used at execution. The [source release procedure](releases.md#single-workspace-version) owns version/tag alignment; release records retain the exact image and any build differences.

The detailed release records below remain operator-maintained provenance. Model information collection is unchanged. Detailed model conditions depend on the selected LM Studio configuration and do not require new per-attempt model/settings fingerprints, model-detail queries or condition identifiers in application collection.

For each research release, record:

- Public source repository, workspace version, tag, commit and tree. Accepted image builds require committed source with a clean worktree and retain matching revision/tree evidence; follow [source identity](deployment.md#source-identity-and-dependency-acceptance).
- Web image tag, image ID, target architecture, and archive checksum.
- Admin and Support deployed revisions and deployment dates.
- Document-set version and manifest SHA-256, with the exact MDX/PDF originals and archive reference used for consent/withdrawal. Keep private institutional originals in the authorized archive and private study records; follow [document-set retention](document-sets.md#archive-and-delivery).
- Questionnaire versions, content-hash identifiers and the exact definitions used by the release, with private institutional inputs retained only in private study records. Research ZIPs retrieve each referenced canonical definition from the hash-addressed archive; preserve release provenance and do not substitute currently edited definitions for historical ones. See [questionnaire identity and delivery](examples.md#questionnaire-definitions) and [research export fields](../apps/admin/docs/data-export.md#research-fields).
- Prompt version/hash, model identifier and file hash, quantization, license, chat template, generation settings, and local inference runtime.
- Input preparation rules, tested conditions and verification limits.

Use synthetic inputs for reproducible checks. Do not publish research documents, participant data, secrets, or private institutional assets. Do not treat a matching hash or repeated output as proof of content validity or reproducibility across runtimes.

Record candidate prompt changes separately from accepted conditions. Model, prompt and generation-setting changes require explicit study-owner instructions. A model may validly report no concerns or no improvement proposals; do not add model answers or detailed steering merely to force a particular result.

Model quality evaluation is outside this repository's functionality. Keep any external evaluation evidence in private research/task records and record the accepted model conditions and verification limits in release provenance.
