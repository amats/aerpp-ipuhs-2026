# Repository structure and visibility

Directory names have the same meaning in every application and package. Ownership, Git visibility and runtime exposure are separate decisions: `package.json`'s `private: true` prevents package publication, but does not hide Git files or HTTP resources.

## Workspace ownership

| Path | Responsibility and visibility |
| --- | --- |
| `apps/<app>/` | Deployable Web, Admin or Support application; public source |
| `packages/<package>/` | Explicitly exported shared code; public source, private workspace packages |
| `config/example/` | Synthetic copy-and-edit templates and runnable local configuration |
| `config/common/` | Public, environment-independent questionnaires, document version input and local model presets |
| `config/<environment>/` | Private operator settings and credentials; see [configuration](configuration.md) |
| `private/` | Operator-owned working inputs, notes, retention decisions and persistent local tool installations/state; never application source |
| `generated/` | Non-public workspace-generated settings, operational state and reports; excluded from Git and application images |
| `distribution/<environment>/` | Private Web installer ZIPs and SHA-256 sidecars for test or production; excluded from Git and application images |
| `scripts/<purpose>/` | Workspace orchestration and colocated tests; see [script ownership](../scripts/README.md) |
| `infra/` | Reviewed infrastructure and installation templates; Terraform lives in `infra/terraform/` |
| `docs/` | Shared human/agent reference guides and the [documentation index](README.md); app-specific behavior stays in the app's `docs/` |
| `skills/` | Shared conditional agent procedures; app-only skills stay with the app |

Use lower-case kebab-case directory names. Keep the established plural `apps/` and `packages/`; `src/app/` is the Next.js routing convention. Do not import another application's source or introduce a dependency from a shared package to an application: promote genuinely shared responsibilities to a package with explicit exports. The [shared boundary check](code-organization.md#dependency-direction) enforces these source import rules.

## Application and package directories

| Relative path | Meaning in every owner |
| --- | --- |
| `src/` | Maintained implementation, declarations and colocated unit/feature tests |
| `src/app/` | Next.js routes and composition, only in Web/Admin |
| `src/features/` | Feature-owned UI, workflows, schemas, services and tests |
| `src/lib/` | Cross-feature infrastructure; never a second feature directory |
| `src/ui/` | Reusable presentation without feature orchestration |
| `public/` | Files served directly by Next.js; every file must be suitable for unauthenticated access |
| `scripts/` | Helpers owned by this application or package |
| `tests/` | Cross-feature or package-wide contracts without a single source owner |
| `test-support/` | Test-only fixtures and helpers, including Web's `test-support/e2e/` |
| `e2e/` | Playwright `*.spec.ts` scenarios; runners/configuration choose normal tests or screenshot capture |
| `templates/` | Maintained input templates, currently used by the configuration package |
| `generated/` | Ignored, reproducible app/package outputs, such as Web PDF checks and Web/Admin license staging |
| `.next/`, `dist/` | Ignored build outputs using the owning framework/bundler's convention |
| `.playwright/`, `test-results/`, `playwright-report/`, `coverage/` | Ignored test staging and evidence |

Create only directories that have an owner and a purpose. Support's small HTTP service and the shared packages keep focused modules directly under `src/`; they do not need UI/feature scaffolding. Web/Admin use [shared code organization](code-organization.md). Tests remain beside their source unless they meet the `tests/` or `e2e/` definitions above.

`packages/contracts/src/` contains the canonical request schemas, the public TypeScript contract and OpenAPI. The package export names remain stable. Its generated schema block stays within the reviewed contract file and is synchronized with `pnpm run contracts:sync`.

`packages/documents/` owns shared PDF rendering and its licensed Japanese font; callers own session authorization, record selection and verified originals. It never persists participant copies. See [document sets](document-sets.md).

Do not create app/package-local `private/`, `secrets/`, `.env*`, `test/`, `__tests__/` or `fixtures/` directories. Private configurations belong at the workspace root; shared test helpers belong in `test-support/`. Web research assets live at the application root: `apps/web/assets-public/` contains tracked publication inputs, and `apps/web/assets/` contains Git-ignored operational inputs. These reviewed MDX/PDF sets are not static `public/` files. The Web asset directory is the specific exception to the root-private-input convention. Supplied asset contents and external-copy directories remain read-only.

## Private inputs, generated outputs and retained state

Choose a directory by ownership and purpose. Root `generated/` contains runtime projections, operation records, expanded bundles, reports and retention archives managed by repository commands. Root `distribution/` contains exported Web installer ZIPs and their SHA-256 sidecars. Root `private/` contains operator-owned working material and persistent installations/state owned by external tools. Editable application settings retain their canonical home in `config/<environment>/`; operational Web assets retain theirs in `apps/web/assets/`.

All three root directories are non-public. A generated file or installer ZIP may contain secrets or irreplaceable operation history, while a downloaded tool under `private/tools/` may be publicly available. Decide visibility, regeneration and retention separately from placement. None of these directories is a blanket cleanup target.

| Path | Owner and lifecycle |
| --- | --- |
| `config/<environment>/config.json`, `secret.json` | Operator-maintained settings; application-key initialization requires the explicit [initial setup command](setup.md#5-supply-stable-application-keys-and-review-shared-assets); never copy credentials between environments |
| `config/<environment>/console-settings.json` | Deliberate generated companion to the editable configuration; regenerate with `env:sync`, never edit |
| `apps/web/assets/` | Operator-maintained private MDX/PDF set for local Web development/builds and test/production distribution images; never publish in Git |
| `private/inputs/<owner>/` | Private working documents or downloaded inputs awaiting explicit classification/import; never read by application startup |
| `private/notes/` | Operator-authored notes, not generated reports |
| `.agents/` | Ignored local agent instructions and handoff notes; `.agents/AGENTS.md` owns shared private-work guidance |
| `.codex/` | Ignored tool-defined Codex configuration/state; preserve its original use and contents, and keep documentation/instructions elsewhere |
| `private/retention/<environment>.json` | Operator-maintained recovery pins; read by retention tooling, never generated or overwritten by it |
| `private/archives/` | Operator-retained historical working inputs or one-off source; maintained commands do not write generated bundle archives here |
| `private/tools/` | Locally installed tools, such as the pinned Firestore emulator and Terraform |
| `private/tools/gcloud/`, `private/tools/docker/<context>/` | Persistent CLI authentication/build state; may contain credentials, retain independently of application output |
| `generated/<environment>/` | Environment-specific runtime JSON, derived metadata, Terraform files, images, bundles and acceptance records |
| `generated/<environment>/bundle-archives/` | Compressed operational bundles produced by retention tooling; preserve independently of expanded bundle cleanup |
| `distribution/<environment>/` | Exported Web installer ZIPs and SHA-256 sidecars for test or production; paths are recorded in `generated/<environment>/web-bundle.json` |
| `generated/<environment>/support-terraform/operator-auth-*.json` | Command-scoped local authentication connection; removed by the Terraform wrapper, contains no Google refresh token or private key, never reuse across commands |
| `generated/reports/<purpose>/` | Environment-independent local audits and synthetic export samples |
| `apps/<app>/generated/`, `packages/<package>/generated/` | Reproducible local output from public inputs; never store credentials, runtime configurations or participant records here |

The root `generated/` directory remains private even though its name matches app/package output directories. Use the canonical destinations above for generated settings, evidence and retained operational state.

The supported environments are `example`, `test` and `production`. Keep environment-specific outputs under `generated/<environment>/` even when they are reports, except for Web installer ZIPs and sidecars under `distribution/<environment>/` for test and production. Do not move current deployment records, Terraform state, credential receipts or send-once claims into a generic report/cache directory. Generated means produced by tooling, not disposable. Follow [private artifact retention](development.md#private-artifact-retention) before removing operational state.

Runtime JSON and materialized credentials can be regenerated from the selected canonical configuration. Accepted deployment records, secret-version receipts, Terraform state and send-once claims record prior operations; preserve them until their owning workflow explicitly retires them. Reports and test outputs may be reproducible, but first check whether another operation or an operator-retained record references them. Compression changes storage form, not ownership, privacy or retention requirements.

The local CLI directories are tool-owned persistent state rather than application inputs. New one-off review outputs belong in `generated/reports/`, not in those tool directories. The common delivery helper uses `private/tools/docker/shared/buildx`; explicit `BUILDX_CONFIG`, `DOCKER_CONFIG` and `CLOUDSDK_CONFIG` overrides still take precedence. Its operation errors are stored under the report area.

`generated/licenses/` is copied from canonical root notices during managed Web/Admin launches/builds. Docker excludes host-generated copies and regenerates them during the build, then explicitly ships the license files. The `/license` page owns their display. Other app-generated output is not a runtime asset. Canonical API schemas and root license inventories are reviewed source artifacts even when a generator updates them; they remain tracked at their semantic source locations.

## Publication and build boundaries

The root `.gitignore` owns shared exclusions at every depth. All app/package manifests set `private: true`; shared packages additionally allowlist their packaged source and omit tests. `public/` is the only directory whose name implies direct HTTP exposure; Git tracking never implies that a file should be served.

Ignoring or moving a file does not remove it from existing commits. Review tracked and staged files and release history under [source verification](releases.md#source-verification). Keep operator records private under the [documentation visibility policy](README.md#public-documentation-and-private-notes).

Each application owns an adjacent `Dockerfile.dockerignore`, with the workspace root as its context. Each context starts fully excluded, admits only that image's inputs, and finishes with identical exclusions for private files, credentials, generated output, dependencies and tests. Web excludes both asset sets from its ordinary context; its wrapper supplies only required operational MDX/PDF files through a named context. The resulting Web image and bundle are private distribution artifacts. The root `.dockerignore` rejects all files for unspecified root-context builds. The Dev Container retains its separate context and host mounts.

`pnpm run verify` checks source placement, package visibility, Docker exclusion agreement, Git exclusions and force-added private or generated paths. After changing structure, update exports, relative paths, Docker inputs, build traces, test discovery and documentation together. Also run the affected builds and browser scenarios. These checks do not replace Git-history/staged-file review or verify live cloud behavior.
