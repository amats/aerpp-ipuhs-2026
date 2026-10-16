---
name: repo-config-env
description: Use when changing configuration configurations, runtime projection, startup/debugger isolation, setup or infrastructure target boundaries.
---

# Workspace configuration

Use the workspace privacy and target-selection rules. Read only the contracts matching the change:

| Changed boundary | Read next |
| --- | --- |
| Editable inputs, generated outputs or secret providers | [Configuration ownership](../../docs/configuration.md#shared-configuration-and-secret-providers) and [output lifecycles](../../docs/structure.md#private-inputs-generated-outputs-and-retained-state) |
| Configuration selection, startup or debugger isolation | [Environment targets](../../docs/environments.md#intended-environment), [private project selection](../../docs/environments.md#private-project-selection) and [configuration package](../../packages/config/README.md) |
| Runtime projection, OAuth or reception deadlines | [Projection boundaries](../../docs/configuration.md#runtime-projection-boundaries), [Support settings](../../docs/configuration.md#support-editable-configuration) and [Admin/logging](../../docs/configuration.md#admin-and-logging) |
| Clone/setup or replacement inputs | [First run](../../docs/development.md#first-run-without-cloud-credentials), [script-assisted setup](../../docs/setup.md) and [templates](../../docs/examples.md) |
| Independent manual/AI environment construction | [Construction reference](../../docs/environment-construction.md), [configuration ownership](../../docs/configuration.md) and [Terraform ownership](../../infra/terraform/README.md#plans-and-ownership) |
| Terraform, images, delivery or retained state | [Deployment](../../docs/deployment.md) and [environment acceptance](../../docs/environments.md#verification-sequence) |
| Backups or scheduled maintenance | [Backup policy](../../docs/configuration.md#firestore-automatic-backups) and [maintenance windows](../../docs/configuration.md#scheduled-maintenance-window) |

## Configuration and startup rules

- `@aerpp/config` owns selection and projection. Pure runtime readers take explicit maps without filesystem reads; Web/Admin server entrypoints retain `server-only`.
- Never select a target from `NODE_ENV`, fall back between configurations or alter global gcloud account selection. Every gcloud request/token uses the selected configuration's operator account and project. Test and production keep distinct projects, application credentials, OAuth clients and Terraform state; operator accounts may be shared.
- Derive secret references and service-account names from canonical operator inputs. Local Admin uses project-bound gcloud impersonation, hosted services use ADC, and only on-premises Logging materializes an existing key from `secret.json`. Never download cloud secret values or automatically create OAuth/service-account credentials. Initialize or replace application keys only at the user's explicit request through [initial setup](../../docs/setup.md#5-supply-stable-application-keys-and-review-shared-assets); preserve existing keys in deployed environments.
- Build child processes through `applicationEnvironment`; exclude ambient credentials, project variables and `NODE_OPTIONS`. Reject app-local dotenv files and retain runtime checks for hosted starts that bypass launchers.
- Preserve environment-independent questionnaires, local-only LLM settings, Web hash/revision storage and the matching session key. Configuration work does not authorize model, prompt or generation-setting changes.
- For setup changes, preserve checked-in development tooling, tracked public research assets and copy-to-private templates. Managed Web/Admin dev/build must stage licenses without a prior test run. Keep the script-assisted procedure in `docs/setup.md` and independent desired-state explanations in `docs/environment-construction.md`, without per-configuration `SETUP.md` copies. Follow the [script layers](../../scripts/README.md#composition-and-operation-layers); phase coordination must not absorb leaf operations or application delivery.

## Verification

Keep declarations, tests, consumers, examples and guidance aligned. Select checks through [repo-testing](../repo-testing/SKILL.md): package changes need `pnpm run check:config`, launcher changes need process-boundary coverage, and configuration changes need the selected `pnpm run env:check`. Apply privacy and guidance checks where affected. Report actual cloud/OAuth/mail/operational checks separately; prose-only changes follow the documentation row of the verification matrix.
