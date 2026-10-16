# Development and verification

## Script ownership

Run pnpm from the workspace root. [scripts/](../scripts/README.md) owns orchestration; application helpers and tests stay with their owners. Use one root lockfile and no GitHub Actions workflows.

The [repository structure guide](structure.md) defines directory names, private and generated ownership and Git, package and Docker visibility. Root `check` includes `scripts/checks/check-workspace-layout.mjs` to prevent placement and publication-policy drift.

Keep `package.json` scripts in the same order across the workspace: `dev`, `build`, `start`, `lint`, `format`, `typecheck`, `test`, `check`, then `verify`. Group each command's colon-suffixed variants with it and sort names within each group. Put remaining purpose-specific commands after these groups, sorted by name so matching prefixes stay together. Omit groups a package does not need; ordering alone does not change command names or execution order inside a script.

Expose maintained development and operator workflows as pnpm scripts. Root `<operation>:<target>` entrypoints expose frequently used app/package scripts; keep their implementation with the owning app/package. Prefer these entrypoints when available, and avoid additional synonymous aliases or agent-only diagnostic entries; invoke those diagnostics directly with Node. The workspace `check` still includes agent-guidance validation, and application production-acceptance validation belongs only to root `verify:release`.

Keep long check sequences in their owning helper scripts. Root `check` delegates to [the workspace check sequence](../scripts/checks/check-workspace.mjs), which runs its steps in order and stops on the first failure. The command-reference checker validates that sequence's pnpm targets along with manifest scripts. Configuration `build` uses its [syntax checker](../packages/config/scripts/check-syntax.mjs) to discover non-test `.mjs` files directly under `src/`, so new runtime modules are checked without extending a shell command.

## Prerequisites

Install tools for the workflow you intend to run:

| Workflow | Required tools |
| --- | --- |
| Install, validate public configuration, build and preview Web | Git, Node.js 24 and pnpm 12.11.2 from [package.json](../package.json) |
| Unit/tooling checks (`check`) | The above, plus `unzip` for archive tests |
| Emulator / browser / publication checks | The above, plus Java 21, the pinned Firestore JAR, and Playwright Chromium with its system dependencies; Support emulator scenarios also exercise browser pages |
| Actual analysis during development | **LM Studio on the host**, serving the selected local model; Dev Container Web uses `http://host.docker.internal:1234/v1` |
| Image builds and operational bundles | Docker with Buildx and Compose, `zip`, and the selected private configuration and shared assets |
| Cloud provisioning and deployment | Google Cloud CLI, Docker and the Terraform version pinned in [versions.tf](../infra/terraform/versions.tf) |

The Dev Container supplies Node, pnpm, Java, archive tools, gcloud and Docker integration; its post-create step installs locked dependencies and shared Chromium with system dependencies. Bash completion is replaced only after successful generation; a failed refresh retains the previous file. Do not repeat those installation commands after successful container setup. Terraform and the pinned emulator JAR have their own setup steps. Outside the container, install Node first, then install the pinned pnpm with `npm install --global pnpm@12.11.2` if it is unavailable. Google Cloud CLI may require Python. No Firebase CLI/login is required.

Shared dependency versions are in [pnpm-workspace.yaml](../pnpm-workspace.yaml); follow [dependency management](#dependency-management) below. Rebuild the container after changing its Dockerfile/setup. Do not bake credentials into images.

For cloud workflows only, authenticate intended operator accounts using gcloud. The private configuration infrastructure.operatorAccount selects the account for every cloud operation; test and production may use the same or different Google accounts and must use different projects. `pnpm run auth:login test` (or `production`) only checks/starts a gcloud login; it does not configure ADC, select a project or deploy. Never rely on global active-account changes for environment selection.

## First run without cloud credentials

Complete [machine preparation](setup.md#1-prepare-the-source-and-development-machine). For a native checkout, or when dependencies have changed since container setup, first run `pnpm install --frozen-lockfile`. The public [research assets](examples.md#research-assets) in `apps/web/assets-public/` are included in Git. A fresh clone needs no private cloud configuration or separately supplied assets. Local Web development/builds prefer `apps/web/assets/` when present and reject an incomplete set. Then run from the workspace root:

```sh
pnpm run env:check example
pnpm run build
```

The build uses the selected Web research assets, synthetic Web/Admin settings and the Support source. Browser tests use only the public asset set. Managed Web/Admin development and build entrypoints stage their license files automatically. No existing `generated/` directory is required. This checks compilation, not model availability or the participant flow.

To inspect the initial Web pages and `/license` locally:

```sh
pnpm run env:run example web dev --hostname 127.0.0.1
```

Open `http://localhost:3000`; stop with Ctrl+C. The public environment names a local Support service but this command does not start Support, Firestore or LM Studio. Admission is closed and mail goes to a synthetic sink when local Support is run. This preview therefore does not complete email authentication or analysis. Use the automated scenarios below for synthetic participation; use [setup](setup.md) for real end-to-end operation. `example admin dev` is unsupported; isolated Admin browser scenarios provide the cloud-free UI verification path.

For the full local suite, install the pinned Firestore JAR once, then run verification. Native setups also need `pnpm run test:e2e:install --with-deps` first; the Dev Container already installs Chromium.

```sh
pnpm run support:emulator:install
pnpm run verify:local
```

Playwright's native system-dependency step may require administrator privileges. The emulator command downloads and checksum-verifies its JAR; dependency/browser/emulator installation needs network access. The tests then use disposable emulator data and local API/model stubs without cloud login or real mail. `verify:publication` also requires the emulator JAR and Chromium; it omits builds and Web/Admin browser suites, but includes Support emulator scenarios. Use `pnpm run check` when only static/unit/tooling checks are needed.

[Synthetic export generation](../apps/admin/docs/data-export.md#synthetic-sample) can run independently without provisioning the full system.

## TypeScript settings

The shared dependency catalog selects TypeScript 7. Node.js 24 is the declared application, Docker and Dev Container baseline; installed patch versions may differ between those environments. Choose compiler settings for each owner's runtime and checker rather than requiring identical configurations.

| Owner | Target and standard libraries | Module handling |
| --- | --- | --- |
| Web/Admin | `ES2025`; `dom`, `dom.iterable`, `es2025` | `esnext` with `bundler` for Next.js |
| Support | Retain `ES2022` and the default libraries, including DOM for checked Playwright browser callbacks | `NodeNext` for Node module/package boundaries |
| Firestore/Documents | `ES2022`; explicitly select `es2022` without browser globals | `NodeNext` for Node module/package boundaries |
| Configuration declaration contracts | Retain the `ES2022` options in the existing package script | `NodeNext`; checks `tests/types.mts` and imported declarations |

Web/Admin pin their library baseline instead of accepting the changing `esnext` API set. Web/Admin, Support, Firestore and Documents explicitly select `types: ["node"]`; imported libraries supply their own types. TypeScript 7 defaults to an empty automatic type-package list. These owners use `strict`, `noEmit`, `isolatedModules` and `verbatimModuleSyntax` for strict checking, per-file transformation compatibility and explicit type-only imports. Next.js and Rolldown own application output. Web/Admin retain incremental checking, Next.js's JSX mode/plugin, generated route types, JSON imports and path mappings. Keep the existing JavaScript helper support and `skipLibCheck` behavior.

Web/Admin check source, unit/browser tests and test helpers, excluding `.playwright` staging and dependencies; Support includes unit/browser scenarios and test helpers; Firestore includes its source and colocated tests. Documents checks its source and enables `erasableSyntaxOnly` for direct Node.js 24 PDF tooling; Next.js bundles the same source for Web/Admin. Test inclusion in type checking does not include tests in production artifacts. Web/Support do not enable `erasableSyntaxOnly` because they use parameter properties supported by their bundlers. Additional checks such as `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` require a separate source migration.

The TypeScript target/library baseline does not select browser compatibility or install API polyfills. Next.js controls browser output through its supported browsers and Browserslist; browser API availability still needs separate verification.

## Workspace commands

Run these entrypoints from the workspace root without `--filter`. Use `pnpm --filter @aerpp/<owner> run <script>` for other app/package commands. The tables below group commands by task; [scripts](../scripts/README.md) maps their implementation owners.

### Development commands

| Command | Purpose |
| --- | --- |
| `pnpm run dev:web` / `pnpm run dev:admin` | Managed test development on ports 3000/3001 |
| `pnpm run build` | Synthetic Web/Admin and Support builds, followed by license-trace checks |
| `pnpm run build:web` / `pnpm run build:admin` / `pnpm run build:support` / `pnpm run build:config` | Individual builds: example Web, synthetic local Admin, Support or config syntax checks |
| `pnpm run lint` / `pnpm run lint:<target>` | Style and import checks; targets: web, admin, support, config, contracts, documents, firestore, tooling |
| `pnpm run format` / `pnpm run format:<target>` | Write formatting changes for the same maintained owners |
| `pnpm run typecheck` / `pnpm run typecheck:<target>` | All type checks or one of web, admin, support, config, documents and firestore |
| `pnpm run test` / `pnpm run test:<target>` | Synthetic unit/tooling tests, or one of web, admin, support, config, firestore and tooling |
| `pnpm run test:watch:web` | Web unit tests in watch mode |
| `pnpm run contracts:check` / `pnpm run contracts:sync` | Check or synchronize the [participant API contracts](#participant-api-contracts) |
| `pnpm run license` / `pnpm run license:check` / `pnpm run license:audit` | Generate notices, check canonical notices or audit installed production coverage; see [license reports](#dependency-license-reports) |

`lint:tooling` and `format:tooling` cover root scripts plus root package/Biome configuration. Formatter scope and protected inputs follow [coding conventions](coding-conventions.md#automated-style-checks). Root `test` excludes emulator and browser suites; invoke their separate commands when required.

Extra arguments on an app/package command go to its owning script. File paths follow that script's working directory: for example, `pnpm run format:web src/features/example/example.tsx` formats a Web file, and `pnpm run test:web src/features/example/example.test.ts` selects a Web test. Format only files in scope during focused changes. Aggregate and tooling commands have fixed scopes; for one root script use `pnpm exec biome format --write scripts/<purpose>/<file>.mjs`.

### Verification commands

Choose checks using [verification by change](#verification-by-change); the gates below serve different acceptance scopes.

| Command | Purpose |
| --- | --- |
| `pnpm run check` | Contracts, guidance, configuration, tooling and application checks |
| `pnpm run check:<target>` | Owner checks; targets: web, admin, support, config, documents and firestore |
| `pnpm run test:emulator` | Isolated standalone Firestore/Support integration |
| `pnpm run test:e2e:admin` | Admin notice CRUD, purpose filtering and separate full source exports with isolated Firestore |
| `pnpm run test:e2e:web` | Web browser scenarios with Support/LLM stubs |
| `pnpm run verify` | PR gate: maintained checks, emulator, diff and privacy checks |
| `pnpm run verify:local` | Checks, emulator, builds and Web/Admin browser tests |
| `pnpm run verify:publication` | Source publication gate; versioned releases also require the [source-release checks](releases.md#source-verification) |
| `pnpm run verify:release` | Application [production acceptance](deployment.md#release-acceptance) |
| `pnpm run audit:release` | Production dependency audit with the narrowly reviewed Mammoth CLI exception |

Ordinary verification uses synthetic inputs and isolated services; it does not connect to cloud or send mail. Report local/unit, emulator, browser, image, cloud, real OAuth/mail and operational-machine evidence separately, using the [result states](#verification-by-change).

### Configuration commands

[Script-assisted setup](setup.md) owns initial execution order. [Environment construction](environment-construction.md) is the reference for independent manual/AI construction.

| Command | Purpose |
| --- | --- |
| `pnpm run auth:login <environment>` | Check/start login for the selected operator; no ADC, project selection or deployment |
| `pnpm run env:init <environment> <project-id>` | Create private editable placeholders |
| `pnpm run env:setup <environment> init <project-id>` | Initialize configuration; subsequent `plan`, `apply [--replace-secrets]` and `check` phases prepare the foundation and validate consumers/Gmail |
| `pnpm run env:prepare-secrets <environment> [--replace] [--upload]` | Initialize application keys for an unused cloud installation; explicit replacement or post-foundation Admin upload |
| `pnpm run env:check <environment> [app]` | Validate selected inputs; no deployment |
| `pnpm run env:generate <environment> [app]` | Optionally export private runtime JSON; managed launches read configurations directly |
| `pnpm run env:sync <environment> --offline` / `pnpm run env:sync <environment> --refresh` | Derive local settings or discover cloud metadata |
| `pnpm run env:run <environment> <app> <operation>` | Isolated Web/Admin dev/build/start or example Support start; production development launches are rejected |

The [script layers](../scripts/README.md#composition-and-operation-layers) keep phase composition separate from domain operations and focused validation/I/O modules; leaf helpers are not additional operator aliases.

### Delivery and maintenance commands

Use the owning procedure for arguments, prerequisites, target selection and side effects. Cloud writes and mail tests remain explicitly selected operations.

| Command family | Owning procedure |
| --- | --- |
| `infra:terraform` | [Terraform foundation, plans and apply](../infra/terraform/README.md) |
| `support:*` | [Support delivery and acceptance](deployment.md#infrastructure-and-support-delivery) and [Support checks](../apps/support/README.md) |
| `admin:*` | [Admin image delivery and traffic promotion](deployment.md#admin-cloud-run-delivery) |
| `web:*` | [Web image, archive registration and bundle delivery](deployment.md#web-images-and-operational-bundles); `web:prepare-documents` and `web:prepare-questionnaires` preview registration unless `--apply` is supplied |
| `cloud:*` | [Cloud inventory](../infra/terraform/README.md#environment-isolation), [secret retention](deployment.md#secret-version-retention) and [image retention](deployment.md#image-retention) |
| `private:*` | [Local bundle, image and cache retention](#private-artifact-retention) |

## Verification by change

Use this matrix for working checks. Combine rows when a change crosses boundaries, and run broader checks when a failure or unresolved concern warrants them. These focused checks precede the [PR, publication and production-acceptance gates](../CONTRIBUTING.md#before-opening-a-pr); they do not replace those gates. Versioned source releases follow [source verification](releases.md#source-verification).

| Change | Working verification | Additional acceptance when affected |
| --- | --- | --- |
| Documentation, AGENTS or skills only | Documentation links, skill references and command references using the checkers below | Exercise changed executable examples; no build, emulator or deployment for prose alone |
| Workspace checks, command wrappers or formatter configuration | Relevant colocated `node:test` suites, `pnpm run lint:tooling`, command/boundary checks and affected owner lint | Check argument/working-directory behavior and protected-file exclusions; build when compilation, toolchain, inputs or build behavior changes |
| App implementation | Owner `check` entrypoint, or focused lint/type/unit checks during iteration | Affected builds for routes/framework/assets; Web or Admin browser scenarios for browser-visible behavior |
| Shared config, contracts or Firestore packages | `pnpm run check:config`, `pnpm run contracts:check` or `pnpm run check:firestore`, and affected consumer checks | Support emulator for shared persistence/API behavior; builds when runtime projection or artifact contents change |
| Shared PDF rendering, font or research document templates | `pnpm run check:documents`, affected Web PDF unit suites and the [PDF form check](../apps/web/docs/testing.md#pdf-form-test) | Inspect generated PDFs for Japanese text, footer placement and clipping; Web/Admin builds for font tracing or artifact changes, and affected browser checks for download/reissue behavior |
| Web participation, session, navigation or recovery | `pnpm run check:web` and `pnpm run test:e2e:web` with synthetic Support/LLM transport | Verify combined cross-tab and late-response behavior; actual local-inference acceptance requires an explicitly selected scope |
| Admin authentication, notice editing, monitoring or export UI | `pnpm run check:admin` and `pnpm run test:e2e:admin` for affected browser behavior | Real OAuth/data acceptance only for changes affecting those integration contracts and an authorized selected environment |
| Support HTTP, authentication, consent, retries, withdrawal or cleanup | `pnpm run check:support`, `pnpm run contracts:check`, `pnpm run test:emulator` | Serving-revision, API and Web connectivity checks for changed deployed behavior in the authorized test project; mail acceptance is separately explicit |
| Configurations, launchers or environment isolation | `pnpm run check:config`, affected tooling/process-boundary tests and selected `pnpm run env:check` | Keep literal-secret and inherited-credential subprocess coverage; validate each affected environment independently |
| Terraform, images or operational bundles | Terraform format/validation and synthetic plan-policy tests, or affected image/bundle tests | Image identity and retained-state checks; selected cloud plan/apply and actual operational-machine acceptance remain explicit operations |

For prose and guidance changes, run the three checks in [documentation maintenance](#documentation-maintenance). For source import boundaries, run from the root:

```sh
node scripts/checks/check-boundaries.mjs
```

Check [prerequisites](#prerequisites) before choosing a suite, including the pinned Node/pnpm versions, archive tools, browser/emulator dependencies and local port availability. Do not bypass a version requirement or weaken a test to manufacture a pass. Test with synthetic data and isolated services; production configurations and real participant records are never fixtures. Use [environment verification](#environment-verification) and the owning app's test guide for setup.

Use four result states in task/PR evidence: **passed** (completed successfully), **failed** (ran and reported a failure), **not run** (including blocked prerequisites), and **not applicable** (outside the changed behavior). Explain environmental failures without relabeling attempted failures as passes or not applicable. Record the command and tested patch/commit, prerequisites and remaining acceptance. A documentation or formatting-only Support change has no cloud acceptance requirement; an affected runtime integration that could not be exercised remains not run.

### Transaction and interruption verification

For changes to the [transaction and failure boundaries](architecture.md#transaction-and-failure-boundaries),
derive tests from the changed commitments and acknowledgement points. Select the
applicable cases below; a prose-only update does not require running application suites.

| Interruption or conflict | Observable invariant |
| --- | --- |
| Required dependency unavailable before admission | Work does not start or claim eligibility; the UI explains how to retry |
| Failure before commit | No accepted fact is reported; temporary ownership is released only under the owning contract |
| Commit succeeds but its response is lost | Retrying the original ID/payload confirms one accepted fact and preserves its first timestamp/outcome |
| Remote acceptance followed by local save or UI failure | The UI preserves accepted or unconfirmed state and offers reconciliation without repeating the business effect |
| Concurrent, changed-payload or stale-generation requests | Exact authorized retries work; conflicting writes cannot replace active work or accepted facts |
| Cancellation races completion, or a late response arrives | One terminal outcome remains authoritative; stale callbacks cannot advance the current flow |
| Required continuation outlives the request/process | Its durable owner resumes unfinished work without recreating accepted facts; RAM-only output is not fabricated |
| Optional print/download/export fails or stalls, including during body reads | Accepted participation remains intact; the UI provides a usable retry, cancel or return path, and any fallback uses the authorized record |

Inject faults at the owning boundary using synthetic services or isolated persistence.
Assert stored facts, side-effect counts and visible recovery choices rather than just
exception messages. Use browser tests for pending-state recovery and available user
actions, and emulator tests for changed Firestore concurrency/atomicity. Report any
unexercised process-restart, actual network or external-service behavior separately;
passing a mock test does not establish those properties.

## VS Code debugging

Select `Web: test` or `Admin: test` in Run and Debug. The matching task starts the test-configuration development server, waits for readiness, and VS Code attaches to its loopback Node.js inspector (Web: 9230; Admin: 9231).

Open `http://localhost:3000` (Web) or `http://localhost:3001` (Admin) manually in your regular Chrome. These configurations debug only the server and do not launch a browser. Use VS Code breakpoints for server code and Chrome DevTools for browser code. This also avoids the Google sign-in rejection observed in debugger-launched Chrome.

The Admin configuration attaches only to the server on port 9231; automatic attachment to its compiler and other child processes is disabled. This keeps helper processes out of the debug session and avoids their debugger disconnect waits. Repeated `Compiled` and page requests while idle indicate a development refresh loop; Cloud Logging failures with gRPC status 8 can follow when repeated page loads exhaust the project's log-list quota. Participant history is read separately from Firestore and defaults to the **実データ** purpose; choose **テスト** to view test participation.

Stopping the attach session disconnects the debugger; use **Tasks: Terminate Task** to stop the corresponding development server when finished.

## Environment verification

Use [environment setup](environments.md) and [configuration](configuration.md). Web/Admin development defaults to test. A local process is not a connection boundary: real Admin OAuth/data still requires the selected cloud. Synthetic tests load no private configurations. Check each selected app independently without requiring another app's credentials.

Run support:emulator:install once to install the checksum-pinned Firestore JAR under private/tools/firestore/. test:emulator starts Java directly with a disposable demo database, loopback-only port and synthetic mail sink. FIRESTORE_EMULATOR_JAR may explicitly select the same verified JAR. Emulator success does not establish cloud IAM, indexes, OAuth, Gmail or Scheduler acceptance.

## Participant API contracts

Canonical request schemas are in packages/contracts/src/request-schemas.ts. contracts:sync updates only the generated block in participant-api.ts; contracts:check verifies schema synchronization, matching runtime/API/OpenAPI paths and methods, and the maintained route/security contract. Do not hand-edit generated schemas. Support routes use one origin and scoped bearer authentication. Keep validators, consumers, OpenAPI and persistence semantics aligned.

## Agent guidance

Root AGENTS.md owns always-applicable workspace rules; app/package AGENTS.md adds local constraints and indexes only that owner's skills. Shared conditional procedures live in root `skills/`; app/package-specific procedures live in that owner's `skills/`. Name skills `repo-<purpose>` and index each once with a direct entrypoint link. Keep invocation criteria in the frontmatter description. Contributor and operation guides own human procedures and command sequences. Put substantial references useful to people and agents in the owning `docs/`, linked by the skill; reserve skill-local `references/` for agent-only details. Read only references matching the task.

Source paths in skills are relative to their owning app/package unless stated otherwise. All maintained pnpm command examples, including app CONTRIBUTING/README files, run from the workspace root: unfiltered `pnpm run` resolves root scripts. Prefer maintained root entrypoints and use explicit package filters for other app/package scripts. Package.json script bodies execute in their owning package, as pnpm defines; that implementation context does not change the documentation convention.

Run the documentation, skill and command checkers after guidance or package-script changes. The skill checker covers the workspace root and immediate `apps/*` and `packages/*` owners, their AGENTS.md/CONTRIBUTING.md and maintained Markdown within their skill directories. Private/generated directories, installed dependencies and Terraform caches are excluded from recursive Markdown discovery in all three checkers. It validates skill namespaces, unique names, frontmatter, indexes, concrete paths, relative links and pnpm script references. The documentation checker also validates fragments; the [command checker](#command-reference-checking) extends script validation to general documentation and manifest delegation. These checks do not establish semantic agreement with implementation or runtime acceptance.

### Local agent guidance

Root `.agents/` and `.codex/` are ignored local directories with different purposes. Use `.agents/AGENTS.md` for private operator instructions and local handoff routing shared by agents. Keep one owner for each instruction; link to the shared local guide instead of duplicating it. Reserve `.codex/` for its tool-defined configuration and state. Documentation maintenance must not add instruction files there or alter its settings, discovery behavior or tool-managed contents.

The tracked root `AGENTS.md` explicitly asks agents to read `.agents/AGENTS.md` when present for private work. Do not rely on the directory name alone for discovery. A public clone must build and verify without either directory. Reusable contributor rules and public repository skills remain in tracked AGENTS files, `skills/` and their owning guides; private instructions do not replace those contracts.

Keep operator records in `private/notes/`; local agent guidance points to those records. Store credentials only in their canonical private configuration or credential provider, not in guidance. Never force-add either directory, publish its contents, or make application startup depend on local agent files. Existing local tool settings and state are not disposable notes.

## Images and operational delivery

Shared Git exclusions live in the root `.gitignore`. All application image builds use the workspace root as their Docker context and their adjacent `Dockerfile.dockerignore` files. The default root context denies all files. Shared final exclusions are checked for agreement across Web, Admin and Support. The Dev Container uses `.devcontainer/.dockerignore` for its own context.

Use the explicitly selected build/check/preparation commands in [deployment](deployment.md) and [Terraform](../infra/terraform/README.md). Builds are local; images and bundles remain private. Cloud changes require the selected target and scope. Keep accepted image/configuration identities in private evidence and preserve the Web coordination volume.

## Private artifact retention

System-generated runtime JSON, plans, images and acceptance evidence belong under generated/<environment>/. Environment-independent audits and synthetic samples belong under generated/reports/<purpose>/. App/package-local generated/ contains only reproducible public-input outputs; see [output lifecycles](structure.md#private-inputs-generated-outputs-and-retained-state). Terraform state caches, current deployment records, operator authentication, image-check evidence and send-once claims must not be bulk-deleted as transient output. private:bundles lists/archives private operational bundles; it does not change cloud resources.

Root `generated/` is owned by repository tooling; root `private/` holds operator working inputs/notes, retention decisions and external-tool installations/state. Both are excluded from publication. Editable application settings remain in `config/<environment>/`. For bundle retention, `private/retention/test.json` is the optional operator-maintained pin list; `private:bundles test --archive` writes compressed bundles to `generated/test/bundle-archives/` after byte comparison and protection checks. Restore an archive into a separate private working directory and validate it before use. The `private:` command prefix describes the non-public artifacts it manages, rather than a required output directory.

`cloud:secrets test|production [--apply]` previews/destroys unprotected old Secret Manager versions. Preparation reuses unchanged uploads and invokes this cleanup automatically. See [secret retention](deployment.md#secret-version-retention) for protected references, private receipts and serialized operations.

`private:images [--apply]` retains one local managed image generation plus container/current-evidence references and bounds unused Buildx cache. Successful image builds invoke it automatically. `cloud:images test|production [--apply]` previews/removes old registry image families with live/prepared protection; Terraform also configures automatic repository cleanup. See [image retention](deployment.md#image-retention) for timing and protection rules.

Old environment artifacts have no recovery role. Remove retired configuration, endpoint manifests and deployment packages after their consumers are gone. Keep actual operator-authored settings/credentials and the maintained system's current evidence. Neither metadata inventories nor Terraform state are database backups.

## Dependency management

Use the default `catalog` in [pnpm-workspace.yaml](../pnpm-workspace.yaml) for external dependencies used by multiple workspace owners, including dependencies used at runtime in one package and only in tests in another. Each consumer declares `"catalog:"` in its own dependency field. Keep single-owner dependencies in that owner's `package.json`, except packages upgraded together with a catalog dependency, such as `@next/mdx` with `next`. Internal packages use `"workspace:*"` rather than catalog entries or registry versions.

Keep catalog entries alphabetically sorted and quote version strings consistently. Retain exact pins where required; `iron-session` uses Admin's existing exact pin for both consumers. Update `next`/`@next/mdx`, `react`/`react-dom` and `tailwindcss`/`@tailwindcss/postcss` together with matching ranges. Named catalogs are only needed for deliberate parallel version lines.

Keep pnpm's default `manual` catalog mode so adding a single-owner package does not automatically populate the shared catalog. Add an existing catalog dependency explicitly, for example:

```sh
pnpm --filter @aerpp/support add 'pino@catalog:'
```

For a new shared dependency, use `pnpm --filter @aerpp/<owner> add <package>@<range> --save-catalog` (with `-D` for development dependencies), then reference it as `catalog:` in every consumer. When promoting an existing dependency, move its agreed range into the catalog and replace every consumer's direct range. Adding a catalog reference does not install the package for owners that do not declare it. See the official [catalog](https://pnpm.io/catalogs) and [add](https://pnpm.io/cli/add#--save-catalog) documentation.

After editing manifests or catalog ranges, run `pnpm install --no-frozen-lockfile` from the root and review the single root lockfile. Catalog-only reorganizations should preserve resolved versions and dependency snapshots. Verify reproducibility with `pnpm install --frozen-lockfile`. Remove unused catalog entries and obsolete version-specific release-age exceptions; keep justified security overrides, patches and build-script permissions separate from catalog version ownership.

pnpm's default release-age delay is 24 hours, so `pnpm outdated` can omit a newly published version. For an explicitly requested fresh release, check registry metadata with `npm view <package> version --prefer-online`, review the upstream release notes and set the agreed version range explicitly. Keep any generated `minimumReleaseAgeExclude` entries scoped to the reviewed exact versions. If metadata is stale, use `pnpm cache delete <package> --yes` before checking again; clearing metadata alone does not update the lockfile or installed packages. Reinstall dependencies and rebuild the affected applications to verify the resolved versions.

Root `check` runs `scripts/checks/check-dependencies.mjs` to reject duplicated shared version declarations, bypassed or missing catalog entries, unused entries, registry references to internal packages and drift between coupled version ranges. After dependency changes, run `pnpm run verify`, `pnpm run build` and `pnpm audit --prod`, and follow the notice procedure below.

## Dependency license reports

After adding, updating or removing dependencies, synchronize the root lockfile and installed graph, then run `pnpm run license`, review missing-text findings and run `license:check`. The workspace's own [collector](../scripts/licenses/collect-license-notices.mjs) reads the installed production graph and package notice files. Runtime notices are staged into each app and checked in build traces. `license:audit` additionally checks installed production dependency coverage. See [notices](../THIRD_PARTY_NOTICES.md) for the canonical procedure.

## Documentation maintenance

Write maintained documentation in English by default, retaining exact UI labels and externally supplied texts where needed.

Follow the [documentation ownership guide](README.md#maintaining-documents). Keep owner guides, configuration examples, scripts and indexed skills synchronized. Run these checks from the workspace root:

```sh
node scripts/checks/check-docs.mjs
node scripts/checks/check-skills.mjs
node scripts/checks/check-commands.mjs
```

They validate local links/heading anchors, guidance indexes, and documented commands/manifest delegation, respectively. They do not detect all outdated prose or establish runtime or cloud acceptance; compare changed descriptions with their owning implementation. Exercise changed executable examples using the [verification matrix](#verification-by-change).

The shared [documentation inventory](../scripts/checks/documentation-files.mjs) includes root guides, public configuration examples, documentation, skills, scripts, infrastructure (including Terraform), patches, and app/package guides. It works without Git metadata and excludes private configurations, editable working documents, generated outputs and installed dependencies.

Documentation and agent guidance use the same local-link validation. It checks inline links/images, reference definitions, hash-prefixed headings, explicit HTML IDs and URL-encoded paths/fragments. Links in fenced code blocks, inline code and HTML comments are excluded; inline formatting still contributes to real heading anchors. Remote URLs and absolute application routes are not fetched or checked.

### Command reference checking

`node scripts/checks/check-commands.mjs` checks maintained Markdown using the documentation inventory and each workspace manifest's script bodies. It recognizes literal `pnpm run <name>` and pnpm’s `test`/`start` shorthands, with `--workspace-root`/`-w`, `--fail-if-no-match` and one exact `--filter <package>` or `--filter=<package>`. Quoted names and shell line continuations are supported. Documentation resolves unfiltered names at the root; script bodies resolve them in the owning package. Delegated targets are checked even when a root alias itself still exists.

Use these forms for maintained script examples; give each command its full name when it needs validation. Placeholders such as `<target>`, dynamic shell expressions, package installation/`exec` commands and historical CHANGELOG entries are outside script-name validation. The checker does not execute commands or validate shell control flow, script arguments, computed filters or runtime behavior. Keep complex shell workflows in their owning scripts and review them with appropriate tests.
