# AERPP

English | [日本語](README.ja.md)

AERPP (AI-assisted Ethical Review Pre-Processing) supports the preparation of research ethics applications. This pnpm workspace contains the participant application, administrator application and Support API. Analysis documents and results are processed only with an on-premises local LLM and are never sent to cloud services or persisted on the application server.

| Directory | Responsibility |
| --- | --- |
| [apps/web](apps/web/README.md) | Participant flow, document preparation and local LLM analysis |
| [apps/admin](apps/admin/README.md) | Authorized survey and operational views |
| [apps/support](apps/support/README.md) | Participant API, email confirmation and scheduled cleanup |
| [packages/config](packages/config/README.md) | Shared configuration and secret-provider contracts |
| [packages/contracts](packages/contracts/README.md) | Shared participant request/response schemas and OpenAPI contract |
| [packages/documents](packages/documents/README.md) | Shared participant PDF rendering and Japanese font |
| [packages/firestore](packages/firestore/README.md) | Shared participant and information persistence |
| [infra](infra/README.md) | Operational Mac bundles and [Terraform cloud infrastructure](infra/terraform/README.md) |

## Choose your starting point

| Purpose | Start here | What you need |
| --- | --- | --- |
| Inspect, build or test the source | [Local verification](docs/development.md#first-run-without-cloud-credentials) | Development tools and tracked Web research assets; no cloud account or running model |
| Inspect the research export format | [Synthetic source exports](apps/admin/docs/data-export.md#synthetic-sample) | Locked dependencies; no cloud data or login |
| Adapt AERPP to your study | [Examples and customization boundaries](docs/examples.md) | Your research materials, questionnaires and independently selected study conditions |
| Develop against your test cloud or install an operational system | [Script-assisted setup](docs/setup.md) | Private configurations, Google Cloud, OAuth/Gmail, and operational hardware |

The operational system combines on-premises Web/LM Studio with Google Cloud Support, Admin and Firestore. Local tests use emulators and stubs; there is no configuration switch for a complete cloud-free production installation. The supplied operational bundle targets Apple Silicon Macs. See [supported scope](docs/examples.md#supported-scope-and-customization) before choosing a different platform or workflow.

## First run

Follow [machine preparation](docs/setup.md#1-prepare-the-source-and-development-machine) to clone the repository and open the existing Dev Container configuration. Its initial setup installs dependencies; native checkouts must complete [dependency installation](docs/development.md#first-run-without-cloud-credentials) first. The public [research assets](docs/examples.md#research-assets) in `apps/web/assets-public/` are included in Git; local development and builds prefer `apps/web/assets/` when supplied. Then, from the workspace root:

```sh
pnpm run env:check example
pnpm run build
```

These commands use synthetic configuration and the selected Web research assets to build all applications without cloud credentials or a running model. They do not start services. Continue with [local tests and the Web preview](docs/development.md#first-run-without-cloud-credentials).

## Cloud-connected development

Complete the applicable [test setup](docs/setup.md) steps for deployed Support, Admin OAuth and operator access before using these commands. For Web analysis, run LM Studio and the selected model on the **development host**; see the [intended environment](docs/environments.md#intended-environment) for connectivity.

```sh
pnpm run env:run test web dev
# In a separate terminal:
pnpm run env:run test admin dev
```

Web uses port 3000 and Admin uses port 3001. `dev:web` and `dev:admin` are shortcuts for these test-cloud launches. They are not the first-run local preview. Production requires its own [deployment acceptance](docs/deployment.md#release-acceptance).

## Study preregistration and citation

The evaluation study associated with AERPP is preregistered on OSF:

Matsushita, A., Ide, M., & Kohno, Y. (2026).
*Evaluation of an AI System for Pre-analysis of Research Ethics Application Documents*
[Preregistration]. OSF Registries.
[10.17605/OSF.IO/MJDEQ](https://doi.org/10.17605/OSF.IO/MJDEQ).

If you use AERPP software or source code, please cite the version you use.
[CITATION.cff](CITATION.cff) provides software citation metadata for the
[v1.0.0 source release](https://github.com/amats/aerpp-ipuhs-2026/releases/tag/v1.0.0).
If you discuss the evaluation study or its protocol, cite the OSF preregistration
above; cite both when you use both the software and the study protocol.
The OSF DOI identifies the study preregistration, not the software release.
See [research release records](docs/research-release.md#public-study-and-source-release)
for the associated source tag, commit and release date.

## Documentation

Use the [documentation index](docs/README.md) for task-based reading paths, workspace guide ownership and application/package references. Contributors start with [CONTRIBUTING.md](CONTRIBUTING.md); operators follow [setup](docs/setup.md) and [deployment](docs/deployment.md).

See [CHANGELOG.md](CHANGELOG.md) for changes, [SECURITY.md](SECURITY.md) for vulnerability reporting, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution.
