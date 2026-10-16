# Workspace scripts

Run the named `pnpm run` commands from the workspace root; command ownership and prerequisites are in [development](../docs/development.md). Paths below classify workspace orchestration. App-only helpers remain in `apps/<app>/scripts/`, and scripts shipped with a bundle remain in `infra/`.

| Directory | Responsibility |
| --- | --- |
| `config/` | Configuration setup, projection and isolated launches |
| `auth/` | Local CLI authentication entrypoints |
| `cloud/` | Shared cloud inventory, secret upload reuse and live image/secret retention protection |
| `admin/` | Admin image, cloud acceptance and Terraform delivery orchestration |
| `support/` | Support images and acceptance |
| `infra/` | Shared Terraform foundation, plan and apply orchestration |
| `web/` | Web images, document/questionnaire archive registration, Compose projection and immutable bundle export |
| `contracts/` | Shared request/OpenAPI generation and package contracts |
| `licenses/` | Workspace notice collection, staging and artifact trace checks |
| `checks/` | Repository documentation, guidance, privacy and workspace checks |
| `maintenance/` | Local private-artifact, managed image and build-cache retention |
| `shared/` | Cross-application command execution and private output helpers |

Keep tests beside their owning script. `pnpm run test:tooling` discovers `scripts/**/*.test.mjs` recursively. A move must update file-relative imports, subprocess paths, package scripts, Docker COPY/allowlists and documentation together. Prefer the existing purpose directory to a new top-level script or a compatibility forwarding file.

## Composition and operation layers

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Initial workflow | `config/setup-environment.mjs` | Compose init, plan, apply and check phases through maintained commands; keep operator review and manual credential boundaries visible |
| Domain commands | `config/environments.mjs`, `config/sync-environment.mjs`, `config/prepare-secrets.mjs`, `infra/terraform.mjs`, app delivery commands | Select one environment and perform one named configuration/infrastructure/delivery operation |
| Focused operations | `config/setup/configuration.mjs`, `cloud/project-services.mjs`, `infra/terraform/backend.mjs`, `inputs.mjs`, `execute.mjs`, `saved-plan.mjs`, `outputs.mjs` | Validate environment/project readiness, manage backend ownership, project accepted inputs, execute Terraform and retain plan/output evidence |
| Pure constraints and primitives | `infra/terraform/*-plan.mjs`, `plan-policy.mjs`, `plan-provenance.mjs`, configuration package readers and shared delivery helpers | Validate a resource family or artifact boundary, or perform a narrow reusable primitive |

Imports flow downward. Focused modules do not call the initial workflow or infer a configuration; side effects are explicit at the owning operation. Keep leaf modules limited to one coherent resource/protocol responsibility. Split at independent validation, state or I/O boundaries rather than creating a generic workflow engine or mechanically enforcing a line count. Resource guards return to the plan-policy coordinator; they do not decide when to apply.

Only maintained operator entrypoints need pnpm commands. Imported helpers stay under their purpose directory with colocated tests where their boundary needs coverage. [Setup](../docs/setup.md) owns the script-assisted procedure; [environment construction](../docs/environment-construction.md) explains the state those scripts establish.

## Repository checks

[Development](../docs/development.md#documentation-maintenance) owns the commands and supported validation syntax. The check entrypoints select inputs and report violations; shared modules discover or validate inputs without running another checker.

| Module | Responsibility |
| --- | --- |
| [check-workspace.mjs](checks/check-workspace.mjs) | Run the ordered root `check` sequence and stop on failure |
| [check-docs.mjs](checks/check-docs.mjs) | Validate maintained documentation links and heading fragments |
| [check-commands.mjs](checks/check-commands.mjs) | Validate documented pnpm commands, manifest delegation and workspace-check targets |
| [check-skills.mjs](checks/check-skills.mjs) | Validate guidance paths, skill names/frontmatter/indexes, links and pnpm references |
| [documentation-files.mjs](checks/documentation-files.mjs) | Discover public Markdown and exclude private/generated directories, installed dependencies and Terraform caches |
| [markdown-links.mjs](checks/markdown-links.mjs) | Parse local Markdown links and validate destinations/anchors |
| [pnpm-script-references.mjs](checks/pnpm-script-references.mjs) | Resolve literal pnpm script references against workspace manifests |
| [workspace-directories.mjs](checks/workspace-directories.mjs), [workspace-manifests.mjs](checks/workspace-manifests.mjs) | Discover app/package owners and their manifest contracts |

Link and command checks use the same documentation inventory. Guidance uses the same Markdown discovery, link validation and pnpm parsing for its owner-specific files. Keep shared parsing in these helper modules; command checks also inspect the sequence exported by the workspace runner. Colocated tests cover checker integration and the shared Markdown parser.

## Private outputs and retention

Use the shared delivery `privateJson` helper for replaceable private JSON outputs. It writes a unique adjacent file with mode `0600`, replaces the destination by rename and removes its temporary payload after a handled failure. This makes each file replacement atomic; it does not serialize operations or make multiple output files transactional. Imported image/secret retention operations accept boolean apply flags, default to preview and reject other values before inspecting or changing resources.

Private retention and restoration are documented in [development](../docs/development.md#private-artifact-retention). Historical one-off code belongs in private archives, not in generated output directories as an additional supported entrypoint.

Repository-managed settings, operation records, expanded bundles and retention archives belong under root `generated/` by environment or report purpose. Web installer ZIPs and their SHA-256 sidecars belong under root `distribution/<environment>/`. Operator-maintained retention pins and external-tool installations/state belong under root `private/`. Follow [placement and lifecycle rules](../docs/structure.md#private-inputs-generated-outputs-and-retained-state); all three directories remain non-public and require lifecycle-aware cleanup.
