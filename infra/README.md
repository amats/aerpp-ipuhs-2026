# Operational configuration

Operational image export/import and recovery follow the [deployment requirements](../docs/deployment.md). The current Compose stack runs `app-aerpp` behind Caddy at `http://localhost/`, and sends container logs through Fluent Bit to Google Cloud Logging. Admin is deployed separately.

| Service | Responsibility | Ports |
| --- | --- | --- |
| `app-aerpp` | Participant application with `/health` check | Internal 3000 |
| `caddy` | Reverse proxy to `app-aerpp:3000` | Host 80; no explicit host-address restriction |
| `fluent-bit` | Docker log receiver and Cloud Logging forwarding | Host loopback `127.0.0.1:24224` TCP only |

Use the immutable private bundle workflow below for Web delivery.

## Host network boundary

The supplied `80:80` Caddy mapping has no host-address restriction; [Docker publishes such ports on all host interfaces by default](https://docs.docker.com/engine/network/port-publishing/#setting-the-default-bind-address-for-containers). Web's port 3000 stays inside the Compose network. Opening `http://localhost/` in the browser does not make that mapping loopback-only. For the intended single-Mac operation, use the host firewall and network policy to prevent access from other machines. Confirm that boundary on the actual operational host; container health checks do not verify it. LM Studio must be reachable from the containers, with access controlled by the same host/network policy.

## Private configuration

Use the selected private configuration as the only editable source: `config/test/` or `config/production/`. Web settings come from the Web projection; Fluent Bit settings and its credential path come from the logging projection. Admin is configured separately.

Normal bundle export generates the Compose override automatically. For a separate configuration diagnostic, generate it from the repository root with an explicit Web image built for the selected environment:

```sh
pnpm run web:generate-compose test <test-web-image>
pnpm run web:generate-compose production <production-web-image>
```

These commands write `generated/test/compose.json` or `generated/production/compose.json`. They validate Web settings and logging credential project metadata, but do not start containers, deploy services, or verify image contents. Regenerate after configuration edits. Do not hand-edit or publish the output: it contains Web secrets. Logging credentials are materialized from LOGGING_SERVICE_ACCOUNT_JSON in the selected secret.json into generated/<environment>/credentials/logging.json and mounted read-only. Do not manage this generated file manually.

For a local configuration check without starting containers:

```sh
docker compose --env-file /dev/null -f infra/compose.yaml -f generated/test/compose.json config --quiet
```

Use `--quiet` to avoid printing resolved secrets. The base Compose file alone is incomplete; the selected override supplies the Web image, environment and logging credential mount. The image must have matching build-time `NEXT_PUBLIC_*` settings and assets. Generation does not verify image contents.

## Logging and runtime details

The app emits JSON to stdout. Fluent Bit parses it with `app_json`; Caddy JSON uses `caddy_json`. Tags are `docker.app-aerpp` and `docker.caddy`. Cloud Logging uses `generic_node` resources with `GCP_LOGGING_LOCATION`, `GCP_LOGGING_NAMESPACE`, and `PARTICIPANT_API_SERVER_ID` from the selected configuration.

The Forward input is unauthenticated and is published only on host loopback for Docker's `fluentd` logging driver. Do not expose port 24224 to the LAN or publish UDP. The container listens on its internal interfaces so Docker can forward the loopback connection; the host binding controls external access. Existing installations need an updated bundle and container recreation for this binding change to take effect.

Never log analysis documents, results, participant content, or secrets. Application and proxy logging must preserve the repository's data boundary.

The app health check requests `http://127.0.0.1:3000/health`; Caddy starts after the app is healthy. Services retain `restart: unless-stopped`. Web mounts the private `web-session-coordination` volume at `/tmp/aerpp-coordination` for allowlisted SQLite session metadata, credential digests and operation/revocation fences. This metadata is not application-encrypted and includes no email, documents, analysis results or survey answers. Tabs share the session without tab ownership. Preserve the volume and matching keys across container replacement; deleting them loses session continuity. Independent Web hosts cannot safely coordinate through separate volumes. See the [Web authority contract](../apps/web/docs/session.md).

Fluent Bit currently inherits host uppercase and lowercase proxy variables through Compose. Proxy settings remain host tooling settings; they are not duplicated in configuration secret files.

## Image delivery and Mac setup

Use the immutable private bundle workflow below.

Start Docker Desktop and LM Studio before using the installed operator. A login-item startup app is not supplied by this repository. Configure optional automatic startup, screen locking and sleep behavior under the institution's device policy, and verify them on the operational Mac.

See [deployment status](../docs/deployment.md) before production use. Validate the selected operational host separately; repository instructions do not establish the state of a running stack.

## Immutable private bundle operations

Build/check the selected environment’s Web image, then run root `pnpm run web:export-bundle test` or `production`. Test and production operational stacks need separate hosts because their default host ports overlap. Every `web:build-image` pulls Caddy and Fluent Bit `latest` for the selected architecture and tests those exact image IDs. It validates the shipped Caddy/Fluent Bit configuration with networking disabled, then tests HTTP proxying and synthetic Forward input/JSON parsing on an isolated internal Docker network. The log test uses stdout instead of Cloud Logging and synthetic data only. A pull or test failure stops the build; cached images are not an automatic fallback.

The Web manifest records those auxiliary image IDs, test results and an infrastructure-configuration fingerprint. `web:check-image` and export require matching evidence; export uses the recorded IDs even if local `latest` tags have moved. Both reject public build-setting, research-asset, questionnaire or bundled LLM preset JSON drift and require rebuilding/checking. All preset JSON files are hashed because the image includes the complete preset directory; changing only the selected filename remains a runtime choice among those bundled files. Existing images whose fingerprints omit LLM presets must be rebuilt. The exporter saves unique bundle tags so `docker load` preserves the Compose references across classic Docker and containerd image stores. Operations validate the platform and recorded index/configuration digest before starting. The exporter includes checksums and release provenance, records a fingerprint of the exported Web runtime settings for release checks, and keeps generated private settings in a separate `config/` directory. It does not upload anything. Copy the entire private bundle through an authorized private channel; never publish it.

Export requires `zip` on the development machine and also creates a checked ZIP plus SHA-256 sidecar under repository-root `distribution/test/` or `distribution/production/`, according to the selected environment. The expanded bundle remains under `generated/<environment>/bundles/`; `generated/<environment>/web-bundle.json` records both the expanded bundle and ZIP paths. On the operational Mac, extract the ZIP and run `bash ./install.sh` from its directory for first installation into `$HOME/aerpp`, or pass another absolute installation path. The script registers the bundled Web/Caddy/Fluent Bit images from `images.tar`, validates their architecture, installs files and retains the local model readiness checks in a temporary probe container. The installer places `operate.sh` in the installation directory. Start application services separately from any directory with `bash "$HOME/aerpp/operate.sh" start`. After successful install/update, the extracted bundle can be deleted. Docker Desktop must be running; no source checkout, Node.js or pnpm installation is needed on the target.

The shipped [bundle instructions](BUNDLE-README.md) own the commands for start/stop, update, rollback, interrupted-operation recovery and explicit configuration changes. Installation already verifies integrity; a later `operate.sh verify` is an optional file diagnostic. Updates preserve installed settings, logging credentials and the session-coordination volume. Rollback restores images with current settings, not Firestore data. Do not delete pending-operation records or session volumes to recover from a failure.

Actual operational hardware testing may be omitted only as an explicit task scope decision and must be reported as unverified. Local checksum/rendering, scripted failure tests and container/local-model checks are distinct evidence.

Caddy runtime/error-access logs remove all request/response headers and URL queries before Docker/Fluent Bit forwarding, including custom browser retry-context headers. Error-access logging remains at WARN, so successful polling/navigation does not create proxy log volume. Auxiliary acceptance exercises a synthetic failed request and checks that private header/body/query markers are absent; this validates the shipped proxy, not independent Cloud Run/platform or LM Studio logs.
