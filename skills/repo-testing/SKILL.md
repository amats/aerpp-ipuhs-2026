---
name: repo-testing
description: Use when selecting verification required by a change or modifying tests, fixtures, environment isolation or verification commands.
---

# Workspace testing

Start with the [change-based verification matrix](../../docs/development.md#verification-by-change). Use [CONTRIBUTING](../../CONTRIBUTING.md#before-opening-a-pr) for PR gates, [source verification](../../docs/releases.md#source-verification) for versioned publishing, [deployment acceptance](../../docs/deployment.md#release-acceptance) for production and [coding conventions](../../docs/coding-conventions.md#tests) for test placement and runners.

- Use synthetic unit/component fixtures without private configurations, real participant records or live services. Preserve environment/account isolation.
- Preserve process-boundary coverage for launcher isolation and literal secrets; module-only mocks cannot establish that behavior.
- Test changed contracts and failure/retry behavior. Select broader checks for cross-owner changes or unresolved concerns.
- For transaction, admission, recovery or delivery changes, derive fault cases from the [transaction and interruption verification matrix](../../docs/development.md#transaction-and-interruption-verification). Check accepted facts and user recovery at commit/acknowledgement boundaries, including optional delivery stalls; do not infer rollback from a rejected request.
- When reviewing or changing a boolean boundary that grants success, permission or progression, apply the [boolean decision rules](../../docs/coding-conventions.md#boolean-decisions). Test acceptance of `true` and rejection of `false`, missing/null values and representative invalid types, including truthy strings such as `"false"`, nonzero numbers, objects and arrays. Verify that rejected input cannot advance the operation or trigger its protected side effects.
- After finding such a defect, search related producers, consumers and equivalent decision points within the affected workflow and owners. Review their contracts and tests, add regression coverage for confirmed defects, and report the inspected scope and remaining gaps. Passing existing checks alone does not establish compliance with the boolean decision rules.
- For test cleanup, follow the [test maintenance rules](../../docs/coding-conventions.md#tests). Preserve moved assertions and retained compatibility coverage; keep scenario inventories in the owning test guide.
- Report passed, failed, not run and not applicable checks as defined by the matrix. Keep local, emulator, browser, image and actual external-service evidence distinct.

Read only references matching the change:

| Area | Read next |
| --- | --- |
| Guidance, commands, source placement or developer tooling | [Workspace verification](../../docs/development.md#verification-by-change), [command checking](../../docs/development.md#command-reference-checking) and the affected checker tests |
| Web browser flow, session or recovery | [Web testing](../../apps/web/docs/testing.md#browser-e2e-tests) and the affected state contracts linked from [Web architecture](../../apps/web/docs/architecture.md) |
| Admin authentication, notice editing, monitoring or exports | [Admin development](../../apps/admin/CONTRIBUTING.md#development) and [export checks](../../apps/admin/docs/data-export.md#runtime-and-checks) |
| Support authentication, consent, exact retries or cleanup | [Local/emulator verification](../../apps/support/README.md#local-verification) and matching [participation contracts](../../apps/support/skills/repo-support-participation/SKILL.md) |
| Shared config, contracts or Firestore | The owning package README/AGENTS and [consumer checks](../../docs/development.md#verification-by-change) |
| Shared PDF rendering, font or research document templates | [PDF package verification](../../packages/documents/README.md#verification), [PDF form checks](../../apps/web/docs/testing.md#pdf-form-test) and affected Web/Admin consumers |
| Configurations, credentials or launchers | [Environment verification](../../docs/development.md#environment-verification) and [configuration skill](../repo-config-env/SKILL.md) |
| Terraform and cloud acceptance | [Plans and ownership](../../infra/terraform/README.md#plans-and-ownership), [environment sequence](../../docs/environments.md#verification-sequence) and [deployment](../../docs/deployment.md) |
| Images and operational bundles | [Immutable bundle operations](../../infra/README.md#immutable-private-bundle-operations), [Web delivery](../../docs/deployment.md#web-images-and-operational-bundles) and the affected image/bundle tests |

Cloud reads/writes, Scheduler dispatch, real OAuth/mail and operational-machine acceptance require their explicitly selected scope. Scheduler dispatch is not completed execution; token refresh is not mail delivery; synthetic log checks do not establish Cloud Logging delivery. Follow the owning guide for immutable image/revision identity, retained state and ambiguous-operation claims.
