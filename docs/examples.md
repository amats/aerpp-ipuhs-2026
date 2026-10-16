# Adapting the public examples

Public examples support both local verification and an independent installation after cloning. They show supported input shapes; sample addresses and credentials are not ready for operational use. Follow [script-assisted setup](setup.md) for the supported installation sequence, [environment construction](environment-construction.md) for independent construction requirements and [configuration examples](../config/example/README.md) for editable fields and secret objects.

## Supported scope and customization

The intended environment is the checked-in VS Code Dev Container for development, an Apple Silicon Mac for operational Web/LM Studio, and Google Cloud for Support/Admin and participant records. See the [environment topology](environments.md#intended-environment) for the components and connectivity. The guidance below describes customization within that arrangement; support for other deployment platforms is not required.

| Change or purpose | Supported configuration or required work |
| --- | --- |
| Compile, inspect Web, or test with fictional participants | Use the public `example` configuration and [local verification](development.md#first-run-without-cloud-credentials). No private cloud inputs or model are needed. |
| Develop against an independent installation | Create `test`; ordinary Web/Admin development uses its cloud services. Create `production` independently for operation. Arbitrary environment names are not accepted by the launchers. |
| Change project, accounts, participant eligibility, reception dates or capacity | Edit the selected private configuration using the [field reference](../config/example/README.md#cloud-configuration-inputs), then regenerate/redeploy affected consumers. |
| Change study explanation, consent, withdrawal or PDFs | Prepare the complete private MDX/PDF set using [research assets](#research-assets), update its human version, rebuild/check Web and register the exact [document set](document-sets.md) before bundle export. |
| Change questionnaire definitions | Follow the [questionnaire replacement procedure](#questionnaire-definitions): edit the shared JSON, validate and rebuild Web, register the definitions, then export the bundle before restarting. Admin reads the archive and needs no content-only rebuild. |
| Change the study name, public Support wording or confirmation email text | Review the [Support source-owned text](../apps/support/README.md#public-pages) as well as Web assets. Those texts are not loaded from the private asset directory or configuration; source changes and a new Support image are required. |
| Change the local model or generation conditions intentionally | Use a supported local preset, update model attribution and [research records](research-release.md), and evaluate the new conditions. This review does not change the supplied conditions. |
| Run the complete application without Google Cloud or Gmail | Requires implementation changes; the emulator/mail sink and stubs are test facilities, not a production backend. |
| Use cloud inference or a remote LLM host | Unsupported by the local-only analysis boundary and endpoint validator. |
| Use a different operational OS/architecture or multiple Web hosts | The supplied install/update bundle targets Apple Silicon macOS with Linux/ARM64 containers. Other delivery platforms require adapting and verifying the tooling; separate Web hosts do not share session authority. |
| Change UI language, the eight-step participant flow or Admin time display | Requires source changes and corresponding tests; these are not configuration settings. |

## Questionnaire definitions

Web reads [survey-initial.json](../config/common/survey/survey-initial.json) and [survey-follow-up.json](../config/common/survey/survey-follow-up.json) from `config/common/survey/` in every environment. These environment-independent study inputs are separate from the protected MDX/PDF research documents. Edit the shared JSON before building Web; do not edit files inside a running image. Admin does not bundle or read these source files.

Questionnaire identity is `jcs-v1:sha256:<64 lowercase hex digits>`, calculated over the entire UTF-8 RFC 8785 canonical JSON, including `survey_version`, descriptions, item order, labels, required flags and reverse metadata. JSON formatting and object-key order do not change identity; strings and array order remain unchanged. Duplicate keys, invalid Unicode and non-finite numbers are rejected. The original file's whitespace and encoding are not retained. Human-readable `survey_version` remains a required nonempty string; it is not the answer linkage key. The shared `@aerpp/config/questionnaire` implementation owns canonicalization and archive naming.

Web uses the same canonical definition for display, validation and identity. Its distribution build canonicalizes the staged inputs, extracts the final image's definitions and records their IDs with the immutable image ID. Before bundle export, register those exact definitions through [Web delivery](deployment.md#web-images-and-operational-bundles). Registration is create-only and verifies existing objects; it never overwrites an older questionnaire. The selected project's `${projectId}-questionnaires` bucket stores `questionnaires/jcs-v1/sha256/<digest>.json`. Project selection provides environment isolation without additional questionnaire environment settings. Keep all used definitions for the research retention period; image cleanup must not remove them.

New submissions contain `questionnaire: { kind, definitionId }` and `answers: { [itemId]: string | null }`. Web includes every answerable item, using null for untouched optional answers and preserving explicit empty strings. Support compares the definition reference and all answers on retries; different references conflict even if answer text is unchanged. Ownership, consent, withdrawal and server-side mutation guards remain required. Analysis completion metadata remains a separate phase.

Web validates required answers, nonblank unique options, unique item/section IDs and matching type definitions. Question IDs must match `[A-Za-z][A-Za-z0-9_-]{0,127}` and pass the shared [answer-field schema](../packages/contracts/src/request-schemas.ts); owner, metadata, contact, credential and reserved persistence keys remain disallowed. Sections are not answers. Selected labels remain strings; score mappings and reverse scoring belong to offline analysis.

Stop operation before changing questionnaires. The single Web instance restarts on image replacement, but the session-coordination volume and session key are preserved. Do not rely on restart to invalidate old browser forms. Web binds drafts and frozen retries to the displayed definition and rejects a changed definition before submission. It never relabels old answers with the new hash or fetches old definitions to continue a form. Use [Web recovery decisions](../apps/web/docs/recovery.md) for explicit reload/retry, and [administrator recovery](study-operations.md#administrator-selected-recovery-destinations) when protected initial work cannot resume. Debug-only reset revokes authority before browser cleanup and does not withdraw or delete accepted records. Admin does not need rebuilding for questionnaire content changes; new questionnaire schema/types may require application changes.

Admin monitoring uses Firestore only, showing question IDs and per-definition counts. Research ZIP creation reads the questionnaire archive: it fetches each referenced definition once, verifies canonical bytes and hash, and includes the definitions and dictionary. JSON/answer CSV and access ZIP downloads do not read the archive. Missing/corrupt referenced definitions fail the research ZIP. Submitted responses require a questionnaire reference; unsubmitted completion metadata has no reference yet. See [export formats](../apps/admin/docs/data-export.md).

## Template inventory

| Example | How to use it for your environment |
| --- | --- |
| [Root tool environment](../.env.example) | Copy to root `.env` only if absent. A development token is optional; application configuration belongs in private configurations. |
| [Configuration](../config/example/config.json) and [secrets](../config/example/secret.json) | Copy-and-edit inputs for independent construction; replace local defaults, secrets and cloud placeholders using the field reference. |
| [Cloud template](../packages/config/templates/cloud-template.json) | Maintained input for `env:setup init` and lower-level `env:init`; the guided setup uses this initializer. |
| [Support template](../packages/config/templates/support-cloud-template.json) | Reference for the `support` section only; it is not a complete configuration. It requires shared server identity, Web recipient policy, infrastructure and private secrets. |
| [Console example](../config/example/console-settings.example.json) | Reference for generated registration instructions. Generate the actual file with `env:sync`; do not register sample URLs. |
| [Document version](../config/common/documents/version.json) | Select the human version for the complete research MDX/PDF set; the [document-set manifest](document-sets.md#identity-and-current-version) also binds every original's exact bytes. |
| [Local LLM preset](../config/common/llm/lms-medgemma.json) | Configure the corresponding model in local LM Studio and select the preset using `web.llmPresetFile`. |
| [Shared questionnaires](../config/common/README.md) | Edit the two authoritative JSON files in `config/common/survey/` for Web; register the built definitions in each selected project's archive for Admin research ZIPs. |

## Research assets

The following eight MDX/PDF study files in `apps/web/assets-public/` are tracked in Git. A fresh clone includes the complete public set for local builds, browser tests and screenshots. For an independent study, copy the entire directory to `apps/web/assets/`, then adapt that Git-ignored private set to your own approved materials. Review the supplied content before operational use. Review publication suitability whenever changing the public set.

| Files | Requirements |
| --- | --- |
| `welcome.mdx` | Study title, intended participants and introduction. |
| `explanation.mdx`, `explanation.pdf` | Consistent study explanation, dates, contacts and data-handling terms. |
| `consent.mdx`, `consent.pdf` | Consent statements; preserve supported `CheckBox` markup and unique IDs in MDX. |
| `withdrawal.mdx`, `withdrawal.pdf` | Withdrawal instructions consistent with the application flow. |
| `plan.pdf` | Study plan distributed by the application. |

The filename list is maintained in [research-assets.mjs](../apps/web/src/lib/research-assets.mjs) and re-exported by [image-inputs.mjs](../apps/web/scripts/image-inputs.mjs). Prepare the private editable inputs from the workspace root:

```sh
cp -R apps/web/assets-public apps/web/assets
```

Copy only when the destination does not exist; preserve an existing private set. Local development, debugging, source builds and PDF checks select `assets/` when it exists, otherwise `assets-public/`. Next.js requires all eight nonempty regular files in the selected directory and never fills gaps from the other set. MDX and PDF selection is fixed together in each build. Creating/removing a directory after building does not switch an existing artifact; rebuild to select another set. Test and production distribution images always require `assets/`; browser tests and screenshots always use `assets-public/` in isolated staging.

Git excludes `assets/`, and `privacy:check` rejects force-added files there. Both asset directories are excluded from the ordinary Docker context. Image builds copy only the eight required private files through a named context, record their hashes, and ship them in the private image. Restart local development after creating or replacing a set. Document changes require rebuilding and checking the affected image and exporting its bundle. Keep separate studies in separate workspaces. Changing MDX does not regenerate PDFs. Keep editable working documents local; they are not required runtime assets. Moving a file out of Git does not remove its existing Git history.

Consent and withdrawal PDFs must contain text form fields named `email` and `date`. The application fills and flattens these fields, then draws the DID directly in the final-page footer; no `did` field is required or used. Keep the footer area blank (approximately 26–45 mm above the bottom edge). Validate prepared templates from the workspace root:

```sh
pnpm --filter @aerpp/web run test:pdf
```

Inspect the generated PDFs for Japanese text, wrapping and page layout. Set the human version in `config/common/documents/version.json`; PDF/MDX or version changes require rebuilding, checking and registering the [document set](document-sets.md) before bundle export. The eight source files remain byte-exact, and generated copies add the footer in code. Shared questionnaire JSON stays in `config/common/survey/`; follow the [definition requirements](#questionnaire-definitions) separately.

## Local model settings

The preset's `model` is the model identifier exposed by LM Studio, and `baseUrl` is its local OpenAI-compatible `/v1` endpoint. `http://host.docker.internal:1234/v1` reaches the host from the container; loopback endpoints such as `http://127.0.0.1:1234/v1` apply when the process runs on the model host. Remote inference hosts are not supported. Model weights are not included or downloaded by this repository; acquire the selected model separately and check that the operational hardware can load and run it.

`web.llmPresetFile` selects a filename under the shared `config/common/llm/` directory, including when the configuration is private. It does **not** resolve under `config/test/llm/` or `config/production/llm/`. To adapt the local endpoint, copy the supplied preset to a new filename in that shared directory, change only the intended values and select that filename in the private configuration. These preset files are public configuration, so keep credentials and private identifiers out of them. A private arbitrary filesystem path is not supported. Keep the original preset for reproducible public checks.

The `generation` object records research conditions, `prompt` supplies the required `system`, `header` and `footer` strings, and `license` records the model's attribution and terms. Preserve all three when copying the preset; any intentional model change must also update the selected research conditions and license metadata. Follow the [LLM preset contract](configuration.md#llm-preset-contract) for required fields and validation of the selected configuration. Configuration maintenance does not change the supplied model, prompts or generation parameters. `env:check example` checks configuration, not whether LM Studio is serving the model.

## Completing an independent installation

Prepare and adapt the private study materials according to [research assets](#research-assets). Source development/builds can use that private set, while public browser tests use `apps/web/assets-public/`. Private project IDs and accounts remain configurable.

Validate the unchanged public configuration with `pnpm run env:check example`. This does not validate your private configuration or research assets. For private cloud configurations, complete foundation metadata and operator inputs through [setup](setup.md), then run `pnpm run env:check <environment>` for all consumers together. Validate replacement PDFs with the asset guide's command. Configuration checks, local inference readiness and private asset checks establish different prerequisites; complete cloud and operational acceptance before use.
