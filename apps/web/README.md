# AERPP (AI-assisted Ethical Review Pre-Processing)

AERPP is a Next.js web app for pre-reviewing research ethics submissions with a generative AI backend (local LM Studio only).

Participants move through research information, consent and email verification, document preparation, local analysis and a post-analysis questionnaire. Follow-up analyses use the follow-up questionnaire. Withdrawal is a separate terminal flow. See [usage](docs/usage.md) for the screens, data handling and reception cutoff, and [recovery decisions](docs/recovery.md) for interrupted work.

## What It Does

- Guided end-to-end ethics preparation flow with progress and summary views.
- Multi-document editing with drag-and-drop import (`DOCX` / `PPTX` / `TXT` / Markdown), editable document names, and no required document order.
- Real-time character counts (Unicode graphemes) per document and total; these are not model token counts.
- Local LM Studio analysis with elapsed-time status and complete results displayed after storage and presentation acknowledgement.
- Session-aware PDF downloads for explanation, plan, consent, and withdrawal documents, with direct browser downloads from the current screen.
- Post-analysis survey with single-choice, JSON-defined Likert (`likert7`), and free-text items in the same browser flow, without a separate pop-up survey page.
- License viewer at `/license` with section links and alphabetically grouped dependency disclosures (MIT text + complete dependency/model notices).
- Development-only inspection pages; see [debug route availability](docs/usage.md#debug-routes).

## Documentation

| Purpose | Guide |
| --- | --- |
| Workspace setup, configuration and deployment | [Documentation index](../../docs/README.md) |
| Participant screens, storage, reset and closure | [Usage](docs/usage.md) |
| Ownership, state transitions and API contracts | [Architecture](docs/architecture.md) |
| Analysis admission, observation and completion retry | [Analysis coordination](docs/analysis-coordination.md) |
| Consent, questionnaire validation/submission and withdrawal | [Participation](docs/participation.md) |
| Browser authority, retries and recovery | [Session contracts](docs/session.md), [shared browser sessions](docs/browser-sessions.md), [recovery decisions](docs/recovery.md) |
| Development and review | [Contributing](CONTRIBUTING.md), [logging](docs/logging.md), [diagnostics](docs/development-tools.md) |
| Browser, screenshot and PDF checks | [Testing](docs/testing.md) |

## Quick Start

For a first look after cloning, follow [local verification](../../docs/development.md#first-run-without-cloud-credentials). A fresh clone uses the tracked `assets-public/` research materials and supports an initial-page preview without cloud credentials or LM Studio. Synthetic participant scenarios use stubs; the unchanged example configuration does not provide an interactive end-to-end backend.

For cloud-connected development, complete the [test setup](../../docs/setup.md) and supply the private configuration as described in [configuration](../../docs/configuration.md). It must identify the deployed Support service and valid credentials. Use the selected local LM Studio model for actual analysis.

```sh
pnpm run env:run test web dev
```

Open `http://localhost:3000`. For synthetic browser, screenshot and PDF checks, use [Web testing](docs/testing.md). Managed launches inject configuration settings and reject app-local dotenv files; root `.env` is for development tools only.

### Web runtime options

[The editable examples](../../config/example/README.md#cloud-configuration-inputs) document supported configuration fields; [runtime contracts](../../packages/config/src/profiles.mjs) list their environment-variable names. Configure values in the shared configuration and preserve literal secrets. Runtime and CLI validation reject whitespace-only required values; see [configuration authority](../../docs/configuration.md#configuration-authority-and-application-order).

- `SESSION_SEAL_PASSWORD` must contain at least 32 characters. Rotation invalidates cookies and sealed results. `IDENTIFIER_HASH_SECRET` must remain stable to preserve participant/PDF identifiers.
- `SESSION_COOKIE_SECURE` defaults to true; use explicit `false` for the actual HTTP deployment. `SUPPORT_RECEPTION_EXPIRES_AT` is required and generated exclusively from `support.access.expiresAt`. It closes study operations without expiring retained participant authority or newly issued browser seals. Admission renews the same credential cookie with 400-day browser retention; ordinary mutations do not rewrite it. Past cutoff settings remain valid at startup so Web can display reception closure. See [session lifetime and cookie issuance](docs/session.md#expiration-and-cookie-issuance) for browser retention, revocation and old-seal limits.
- The selected configuration supplies the Support origin and scoped Bearer credential. Fixed routes come from the shared contract. See [Support configuration](../../docs/configuration.md#support-editable-configuration).
- `LOG_LEVEL` accepts `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`, defaulting to debug outside production and info in production.
- `NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN` is a regex source or `/source/flags` form with flags stripped. It is fixed at build time. The Web reader permits blank values for default email validation; cloud configurations require an explicit nonblank pattern shared with Support. Invalid regexes fail validation.
- `LLM_PRESET_FILE` selects a local JSON model configuration; see [Model Configuration](#model-configuration). `DEBUG_PAGES_ENABLED` controls debug routes only outside production.

## Running the App

Use root `pnpm run env:run test web dev`, `pnpm run env:run test web build` or `pnpm run env:run test web start` for the selected test configuration. Production supports build/start with its own configuration, not dev. A build does not configure a later process; supply runtime settings again.

The complete public MDX/PDF set is tracked in `assets-public/`. Local development, debugging, source builds and PDF checks prefer Git-ignored `assets/` when present; a fresh clone uses `assets-public/`. An incomplete private set is an error, not a request to mix public files. Browser tests and screenshot capture always use `assets-public/`. Web questionnaires always come from `config/common/survey/`; Admin research ZIPs read the registered definitions from the selected project's archive. See [research assets](../../docs/examples.md#research-assets) and [questionnaire definitions](../../docs/examples.md#questionnaire-definitions).

The app-local `env:check` CLI supports `--process-only` or explicit diagnostic files; [validation modes](docs/development-tools.md#environment-validation-modes) describes precedence. Required checks live in the [workspace contributor guide](../../CONTRIBUTING.md#before-opening-a-pr).

## Operations

Build from the workspace root with `pnpm run web:build-image test` or `production`. Both builds require the private `assets/` materials, supplied through a separate Docker build context; image names derive from each configuration’s `PARTICIPANT_API_SERVER_ID`. See [workspace deployment](../../docs/deployment.md#web-images-and-operational-bundles) for tags, architecture, runtime configuration and the remaining distribution gates.

`GET /health` remains a liveness endpoint; it does not verify LM Studio or participant APIs. Build-time secrets do not configure running containers. Validate runtime settings separately before recreating a container.

### HTTP-only Production

The application supports HTTP-only production operation. Set `web.sessionCookieSecure` to the string `"false"` in the selected private `config.json`; projection supplies `SESSION_COOKIE_SECURE=false` to the container, including when `NODE_ENV=production`. Apply the change through the [bundle configuration-change procedure](../../infra/BUNDLE-README.md#explicit-configuration-changes). The build secret alone does not configure the running container, and restarting an existing container does not change its configured environment.

The image listens internally on HTTP port 3000. The maintained Compose stack publishes Caddy on host port 80 and proxies to Web; open `http://localhost/` on the operational Mac. See the [host network boundary](../../infra/README.md#host-network-boundary) for the actual binding and access requirements.

Browser HTTPS-only warnings are separate from cookie settings and must be handled through the operational browser policy; the application cannot disable them.

## Model Configuration

- Default config: `config/common/llm/lms-medgemma.json` uses LM Studio with `medgemma-27b-it`.
- `generation.temperature`, `topP`, `topK`, `repeatPenalty`, and `seed` are required numbers, with checked-in values of `0`, `1`, `0`, `1`, and `0`, respectively. The loaded model and LM Studio runtime determine their effective behavior. See [LLM integration](docs/architecture.md#llm-integration) for the HTTP request mapping.
- `baseUrl` must use HTTP(S), a `/v1` path, and `host.docker.internal`, `localhost`, `127.0.0.1`, or `[::1]`. Credentials, query strings, fragments, other hosts, and HTTP redirects are rejected. There is no external fallback. For Docker, keep the default host and enable access to LM Studio's server from the container. Linux Docker deployments may need `--add-host=host.docker.internal:host-gateway`.
- Start LM Studio's server with API authentication disabled and make the selected preset's `model` available locally. No model download or remote tool integration is requested by the application.
- Select the preset filename with `web.llmPresetFile` in the private configuration; projection supplies `LLM_PRESET_FILE`. Follow the [local model settings guide](../../docs/examples.md#local-model-settings) when adapting the endpoint. External-provider fields such as `target`, `apiKeyEnv` and `apiKeyRequired` are rejected.
- Model runtime settings and model-related notices are defined together in the selected LLM config. The selected config's license notice is listed on `/license` under "使用モデルのライセンス".

## License

This repository's source code is licensed under the [MIT License](../../LICENSE).

Third-party dependencies, bundled assets (including fonts), and model terms are licensed separately. Check:

- [`NOTICE`](../../NOTICE)
- [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)
- `/license`
- [Bundled license texts](../../THIRD_PARTY_NOTICES.md#license-texts)

## Contributing

`README.md` focuses on using, running, and evaluating the app.
Contributor workflows, branching, coding conventions, route implementation rules, logging rules, and PR checks are documented in [`CONTRIBUTING.md`](CONTRIBUTING.md).
