# Documentation

Start with the [project README](../README.md) for the system overview. Choose a workflow below; maintained pnpm commands run from the workspace root, preferring the [root entrypoints](development.md#workspace-commands). Source and output paths in application guides are relative to that application.

## Start by task

| Task | Read first | Continue with |
| --- | --- | --- |
| Clone, build or preview without cloud credentials | [First run](development.md#first-run-without-cloud-credentials) | [Development tools](development.md#prerequisites) and [verification](../CONTRIBUTING.md#before-opening-a-pr) |
| Edit or review the source | [Contributing](../CONTRIBUTING.md) | [Coding conventions](coding-conventions.md), [code organization](code-organization.md) and [Next.js development](nextjs.md) |
| Maintain documentation or workspace scripts | [Document ownership](#maintaining-documents) and [script ownership](../scripts/README.md) | [Workspace commands](development.md#workspace-commands), [repository checks](../scripts/README.md#repository-checks) and [documentation maintenance](development.md#documentation-maintenance) |
| Adapt the system to a study | [Examples and customization](examples.md) | [Configuration](configuration.md) and [research release records](research-release.md) |
| Replace study originals or maintain participant PDFs | [Research assets](examples.md#research-assets) | [Document identity and archive](document-sets.md), [PDF renderer](../packages/documents/README.md) and [PDF checks](../apps/web/docs/testing.md#pdf-form-test) |
| Set up test/production through scripts | [Script-assisted setup](setup.md) | [Environment boundaries](environments.md) and [deployment](deployment.md) |
| Construct or inspect an environment independently, including with AI | [Environment construction reference](environment-construction.md) | [Configuration](configuration.md) and [Terraform ownership](../infra/terraform/README.md) |
| Install, update or recover operational Web | [Web delivery](deployment.md#web-images-and-operational-bundles) | [Operational infrastructure](../infra/README.md) and [bundle instructions](../infra/BUNDLE-README.md) |
| Understand consent, records and withdrawal | [Architecture and data boundaries](architecture.md) | [Document sets](document-sets.md), [Web participation](../apps/web/docs/participation.md) and [Support persistence](../apps/support/docs/persistence.md) |
| Review storage, privacy and study operations | [Data storage and protection](data-handling.md) | [Recovery, session lifetime and closure specification](study-operations.md) and [study-period change policy](research-release.md#study-period-change-policy) |
| Recover a participant after an interrupted operation | [Web recovery decisions](../apps/web/docs/recovery.md) | [Administrator destinations and reauthentication](study-operations.md#administrator-selected-recovery-destinations) and [Admin lookup](../apps/admin/docs/monitoring.md#researcher-recovery) |
| Change reception dates or close a study | [Reception maintenance](study-operations.md#reception-changes-during-maintenance) or [study closure](study-operations.md#study-closure-and-deletion) | [Configuration](configuration.md) and [delivery](deployment.md); closure includes verified exports before cloud deletion |
| Inspect operational counts or export research data | [Admin monitoring](../apps/admin/docs/monitoring.md) | [Separate source exports](../apps/admin/docs/data-export.md) |
| Prepare or publish a source version | [Source releases](releases.md) | [Verification](releases.md#source-verification) and [attribution](../THIRD_PARTY_NOTICES.md) |

## Workspace guide ownership

| Guide | Owns |
| --- | --- |
| [Development](development.md) | Tool prerequisites, task-grouped commands, change-based verification, debugger workflow and documentation checks |
| [Coding conventions](coding-conventions.md) | Style, comments, tests, protected copies, logging and review order |
| [Code organization](code-organization.md) | Web/Admin definition files, feature placement and import direction |
| [Next.js development](nextjs.md) | Framework exports, Server Functions, cookie mutation and boundary handling |
| [Architecture](architecture.md) | Cross-application participation, record meanings, recovery and data boundaries |
| [Identifiers](identifiers.md) | PID/DID reproducibility, independent ID representations and Admin document verification |
| [Document sets](document-sets.md) | Exact-byte MDX/PDF identity, archived originals, consent/withdrawal binding and participant copies |
| [Data handling](data-handling.md) | Current storage inventory, encryption/hash locations, retention and download boundaries |
| [Study operations](study-operations.md) | Implemented recovery destinations/session lifetime, maintenance reception changes, closure and required acceptance |
| [Examples](examples.md) | Copy-and-edit inputs, required fields and customization limits |
| [Configuration](configuration.md) | Editable settings, secret providers and application runtime projection |
| [Repository structure](structure.md) | Directory roles, private and generated lifecycles and publication visibility |
| [Environments](environments.md) | Host/cloud topology, target isolation and cloud verification sequence |
| [Setup](setup.md) | Script-assisted machine/configuration/foundation preparation, manual credential pauses and initial delivery/acceptance |
| [Environment construction](environment-construction.md) | Non-procedural desired-state, dependency, credential and ownership reference for independent construction |
| [Deployment](deployment.md) | Private application delivery, retention, production-acceptance gates and recovery |
| [Research releases](research-release.md) | Study conditions and reproducibility records |
| [Source releases](releases.md) | Single workspace version, manual changelog, source verification and GitHub publishing |
| [Scripts](../scripts/README.md) | Workspace orchestration layers and repository checker/helper ownership |

## Application and package guides

| Owner | Entry point | Detailed references |
| --- | --- | --- |
| Web | [README](../apps/web/README.md), [contributing](../apps/web/CONTRIBUTING.md) | [Usage](../apps/web/docs/usage.md), [recovery decisions](../apps/web/docs/recovery.md), [architecture](../apps/web/docs/architecture.md), [analysis coordination](../apps/web/docs/analysis-coordination.md), [shared browser sessions](../apps/web/docs/browser-sessions.md), [participation](../apps/web/docs/participation.md), [sessions](../apps/web/docs/session.md), [logging](../apps/web/docs/logging.md), [browser/PDF checks](../apps/web/docs/testing.md), [diagnostics](../apps/web/docs/development-tools.md) |
| Admin | [README](../apps/admin/README.md), [contributing](../apps/admin/CONTRIBUTING.md) | [Monitoring](../apps/admin/docs/monitoring.md), [information management](../apps/admin/docs/information.md), [source exports](../apps/admin/docs/data-export.md) |
| Support | [README](../apps/support/README.md) | [Persistence and cleanup](../apps/support/docs/persistence.md) |
| Configuration | [Package guide](../packages/config/README.md) | [Public templates](../config/example/README.md), [shared inputs](../config/common/README.md) |
| Participant API contracts | [Package guide](../packages/contracts/README.md) | [Schema synchronization](development.md#participant-api-contracts) |
| Participant PDFs | [Package guide](../packages/documents/README.md) | [Document sets](document-sets.md), [identifier contracts](identifiers.md) and [PDF checks](../apps/web/docs/testing.md#pdf-form-test) |
| Firestore | [Package guide](../packages/firestore/README.md) | Shared references, queries and snapshot contracts |
| Infrastructure | [Operational guide](../infra/README.md) | [Terraform](../infra/terraform/README.md), [bundle instructions](../infra/BUNDLE-README.md) |

## Maintaining documents

Keep each specification or procedure in its owning guide; other documents provide a short introduction and link. README files introduce an owner and its starting points. CONTRIBUTING files own contribution and review requirements. Root `docs/` owns shared material; app-specific contracts and diagnostic procedures stay in the app's `docs/`.

People and agents use the same maintained references. `AGENTS.md` and `skills/**/SKILL.md` add agent routing and task selection. Put reusable specifications and human procedures in the owning `docs/`, and link them from the relevant skill. Keep reusable agent-only procedures in skills; use skill-local `references/` only for substantial agent-only details. Private installation instructions and local handoff guidance belong in ignored `.agents/`, following [local agent guidance](development.md#local-agent-guidance). Preserve `.codex/` for its tool-defined configuration and state.

Write maintained documentation in English, preserve supplied texts and exact UI labels, and keep third-party license texts unchanged. When moving a file or heading, update all incoming links, guidance and command examples. Run the [documentation, guidance and command-reference checks](development.md#documentation-maintenance). Record individual test/review runs in task or PR evidence, not permanent guides.

### Public documentation and private notes

Public guides describe the current supported behavior, setup inputs, contracts and operational limits. They must remain usable from the published source alone. README files introduce the project, its use and its documentation. Keep required fields, validation failures, retention rules and recovery limits in their owning guides.

Installation-specific decisions, local work plans and operator records belong in ignored `private/notes/`; private agent instructions belong in `.agents/`. They are not prerequisites for independent installation. Refer to private destinations as code paths, not Markdown links that would break in a fresh public clone. Do not force-add private notes or copy them into release attachments.

Document changes and compatibility actions affecting released versions in the public [changelog](../CHANGELOG.md) and owning guides under [the release policy](releases.md#manual-changelog). Keep individual execution diaries in task or private operator records.
