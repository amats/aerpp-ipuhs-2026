# Local, test and production environments

Test development and production operation are independent. Use distinct Google Cloud projects, OAuth clients, caller credentials, email token keys, runtime identities and state. Operator accounts may be the same or different; specify the intended account in each private configuration. Never derive production credentials from test or select a target from NODE_ENV.

| Connection target | Configuration | Purpose |
| --- | --- | --- |
| None | Synthetic inputs | Unit tests and browser scenarios with local stubs |
| Local Firestore emulator | `example` — public `config/example/` | Support API with synthetic mail; no cloud login |
| Test cloud | `test` — private `config/test/` | Development, integration and explicitly requested mail acceptance |
| Production cloud | `production` — private `config/production/` | Operation and explicitly selected deployment/acceptance |

## Intended environment

| Location | Maintained environment and role |
| --- | --- |
| Development/build machine | Host with VS Code, the Dev Containers extension, Docker and **LM Studio**. The checked-in Linux container uses the Node.js 24 Debian Trixie base, pnpm 12.11.2, Java 21 and gcloud. Docker commands use the host engine through Docker-outside-of-Docker. LM Studio runs on the host, outside the container. See [tool prerequisites](development.md#prerequisites). |
| Developer settings | Root `.env` supplies development-tool variables to the Dev Container. Prepare it before opening the container and preserve existing contents; see [machine setup](setup.md#1-prepare-the-source-and-development-machine). Optional agent tooling has its own settings and authentication. |
| Operational participant machine | Apple Silicon Mac, Docker Desktop and local LM Studio. The private bundle contains Linux/ARM64 Web, Caddy and Fluent Bit images. Participants use a browser on that Mac at `http://localhost/`; LM Studio runs on the host. Git, Node and pnpm are not needed there. |
| Test / production cloud | Separate Google Cloud projects with Cloud Run Support and Admin, Firestore, Secret Manager, Scheduler, Logging and Monitoring; Gmail OAuth provides participant mail. Terraform owns their infrastructure. |
| Administrator browser | Accesses the selected Cloud Run Admin URL through Google sign-in and the explicit allowlist. Local Admin development uses port 3001 and the test cloud. |

Operational Web connects to LM Studio through `host.docker.internal` and to the selected Support HTTPS service; Fluent Bit sends sanitized logs to Cloud Logging. Support uses Firestore and Gmail. Analysis documents/results stay on-premises. This arrangement requires internet connectivity for participant authentication, surveys and cloud operations even though inference is local.

During development, Web in the Dev Container also reaches the host's LM Studio at `http://host.docker.internal:1234/v1` using the supplied preset. Start LM Studio's local server, load the selected model and allow access from the container with API authentication disabled. Installing Node dependencies does not install or start LM Studio. Actual analysis requires it; compilation, initial-page preview and stubbed tests do not. See [model configuration](../apps/web/README.md#model-configuration).

The supplied operational Compose stack is intended for browser use at `http://localhost/`; the secure-cookie setting must match that delivery mode. Its port publication is not restricted to loopback; review the [host network boundary](../infra/README.md#host-network-boundary) during machine setup. Changing a cookie flag does not configure HTTPS. Hosting Web for remote browsers or changing the proxy/host platform requires separate deployment work and acceptance. Multiple independent Web hosts are not supported because session authority depends on the preserved local coordination volume. Test and production operational stacks use the same default ports and require separate hosts.

LM Studio must already expose the selected local model at the configured endpoint; model weights and a universal hardware sizing guarantee are not supplied. Check the actual model/quantization on the intended Mac during [operational acceptance](setup.md#11-build-web-and-deliver-the-operational-bundle).

## Private project selection

The command target and configuration directory use the same name: `test` or `production`. Each private `config.json` owns `projectId` and `infrastructure.operatorAccount`; the environment name does not determine the Google Cloud project ID. The cloud wrapper sets the account explicitly for the selected project, without changing the globally active gcloud account. Missing accounts or conflicting projects fail; there is no fallback to another configuration. Authenticate each intended account with gcloud separately. Firebase login is unnecessary.

Cloud operations, Admin login and Gmail sending have separate authorization settings; their Google accounts may be the same or different. On-premises logging credentials and Cloud Run runtime service identities remain bound to the selected project. Credential JSON files must belong to that project. Never put actual IDs, account addresses, URLs or credentials in public files.

Terraform uses separate versioned GCS backends and local working data under generated/<environment>/support-terraform/. Application images, runtime snapshots, acceptance records and generated Compose inputs are also environment-specific. Do not copy auto.json, deployment records, state or credentials between environments. Running a test operation must not write production metadata or alter production resources.

## Verification sequence

1. Run pnpm run verify:local for local code, standalone Firestore emulator, builds and stubbed browser checks.
2. Build/check the selected test images locally and deploy through the reviewed Terraform workflow in [deployment](deployment.md).
3. Run selected Support cloud, data and Scheduler checks. Confirm actual Admin OAuth and ordinary participant mail/confirmation separately. Mail and notification tests are explicit, never part of routine verify.
4. Validate the private Web bundle on the operational machine using test cloud and the local LLM.
5. Configure production independently and repeat the applicable deployment and acceptance checks there. Test evidence never substitutes for production evidence.

Each independent installation must collect its own test and production evidence. Configuration, closed deployment, admission activation and operational-machine validation are separate stages; generating a configuration or planned service URL does not establish readiness.

Analysis documents/results remain on-premises and never enter cloud authentication, survey, logging or mail flows. Never copy production participant records to test.

## Cloud construction and deployment

Follow [script-assisted setup](setup.md#2-prepare-the-google-cloud-project-and-private-configuration) for configuration and operator inputs, followed by its foundation plan/apply phases. [Environment construction](environment-construction.md#project-services-and-state-backend) explains API, billing, backend and resource requirements for independent construction. Terraform manages infrastructure; see [its guide](../infra/terraform/README.md) for ownership and plan constraints.

## Publication check

Run pnpm run privacy:check. It reads private project IDs from the selected configuration files and scans current public files without printing sensitive values. This does not inspect Git history or replace staged-file, OAuth-client, URL and credential review. Follow [source verification](releases.md#source-verification).
