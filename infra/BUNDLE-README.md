# Private Web distribution

This bundle contains runtime settings and logging credentials. Keep it in an authorized private location. The operational machine does not need the source repository or pnpm.

## Prerequisites

Start Docker Desktop on an Apple Silicon Mac. Before installation, install LM Studio and the selected model, start its server, and make the model recorded in `llm-config.json` available for readiness checks. The scripts do not change models or generation settings. Cloud authentication and log forwarding require internet access.

Use the browser on this Mac at `http://localhost/`. The bundled proxy publishes HTTP port 80 without a host-address restriction, which means all host interfaces under Docker's default settings; localhost use alone does not restrict other machines. The operational host's firewall/network policy must prevent unintended remote access to Web and LM Studio while allowing container-to-model connectivity. Confirm this on the target machine before participant use.

## Initial installation

Extract the ZIP and run the following command from the bundle directory. The default installation directory is `$HOME/aerpp`. Pass an absolute path to use another location.

```sh
bash ./install.sh
```

The installer verifies checksums, loads the bundled images with `docker load`, validates their architecture and installs settings and release files. It retains the local model connectivity and synthetic generation checks in a temporary probe container, which is removed afterward. Application services are started separately with the start command below; a successful start also verifies Compose health.

Initial installation requires an empty destination. Finish any existing analysis first. The installer does not automatically stop or remove containers running under another configuration. For an existing installation, use the update or start commands below. To upgrade an older installation that has no installed `operate.sh`, run `bash /path/to/new-bundle/operate.sh update /absolute/existing/install/directory --maintenance`. This adds the installed operator; an existing uppercase `AERPP` directory can stay at its original path. Do not rename an accepted installation: its release links and container mounts use that path.

`images.tar` is a Docker archive containing Web, Caddy and Fluent Bit images with unique bundle tags. The operator checks their platform and accepts the recorded containerd index or classic Docker configuration digest before use. The operational machine does not download or build images. Web connects to the Support service in the cloud environment fixed in the bundle.

The installed layout is:

```text
$HOME/aerpp/
  operate.sh              Installed operation entrypoint
  README.md               These instructions
  config/                 Runtime settings and logging credentials
  releases/<release-id>/   Compose, pinned image references and readiness scripts
  current -> releases/<release-id>
  previous -> ...         Created after an update
  .pending-operation      Present until an installation/update/rollback succeeds
  .operation-lock/        Present while an operation is running
```

After a successful install or update, delete the extracted bundle if desired. All subsequent start, stop, verify, rollback and recovery operations use the installed files. Keep the bundle until a failed install or update has been retried successfully.

## Update and rollback

Extract the new ZIP, then use the installed operator with the path to that extracted bundle. If you installed elsewhere, use the operator in that installation directory.

```sh
bash "$HOME/aerpp/operate.sh" update /absolute/path/to/new-bundle --maintenance
bash "$HOME/aerpp/operate.sh" rollback --maintenance
```

Updates preserve installed settings, credentials and the session volume. Bundles with different runtime settings or logging credentials are rejected; follow the configuration-change procedure below. Rollback restores the previous image set without rolling back Firestore data.

## Failed or interrupted operations

After fixing Docker or LM Studio, repeat the original installation, update or rollback command. Update retries require the same unmodified bundle: the pending record binds its action, release and checksums. A failed first installation with no accepted release can also be retried using a corrected, newly exported bundle if its runtime settings and credentials match the partially installed configuration. The installer preserves those settings; it never substitutes a modified bundle under the same release ID. Completed installations still reject `install`. Never delete the installation, its pending record or the coordination volume to retry.

A failed Compose health check can leave partially replaced containers even though `current` still identifies the accepted release. To restore that release after a failed update or rollback:

```sh
bash "$HOME/aerpp/operate.sh" recover --maintenance
```

Recovery retains the pending operation. Repeat its original command and bundle when ready. Initial installation has no accepted release to recover; repeat `install.sh` instead. Ordinary `start` is blocked while an operation is pending. `stop --maintenance` remains available once the staged Compose files and installed settings exist.

Operations on one installation are serialized. Normal exits and handled interruptions release `.operation-lock`. After a forced termination or host crash, inspect its `pid` and confirm that no operation is still running before removing only that stale lock directory. Keep `.pending-operation` so the original operation can resume. Use the same installation path for all operations on a host.

## Explicit configuration changes

Finish or recover/resume any pending operation first. Prepare changed settings in the selected private configuration on the build machine, rebuild/check if public build settings or institutional assets changed, and export a new verified bundle. Keep the environment, participant identity and session encryption key unchanged for routine updates.

Stop active analysis, verify the new bundle with `bash /path/to/new-bundle/operate.sh verify`, and stop the installed services with `operate.sh stop --maintenance`. Confirm that `config/profile.txt` matches the installed configuration. Explicitly replace the installed `config/runtime.json` and `config/logging-credentials.json` with the reviewed files from that bundle, retaining private file permissions, then run `update ... --maintenance`. Do not hand-edit generated files or automatically rotate credentials. This procedure changes the installed configuration; image rollback continues to use that configuration.

## Start and stop

Start Docker Desktop and LM Studio with the configured model, then run from any directory:

```sh
bash "$HOME/aerpp/operate.sh" start
bash "$HOME/aerpp/operate.sh" stop --maintenance
bash "$HOME/aerpp/operate.sh" verify
```

Startup checks the local model list and a short synthetic generation, then waits for Compose health. After successful startup, open `http://localhost/`. It does not pull images or build on the operational machine. The selected configuration explicitly fixes the Compose project name, including its coordination-volume name, regardless of the host's `COMPOSE_PROJECT_NAME`. If `start` fails, fix Docker or LM Studio and repeat `start`; an initial installation does not need to be repeated. Failed updates and rollbacks use the retry/recovery procedure above.

Build-machine verification does not establish operational-machine acceptance. Verify the actual browser flow after installation and startup.

Install test and production on separate hosts and keep their settings and credentials separate.

If Docker reports a missing image, restore it with `docker load -i /path/to/matching-bundle/images.tar`, then repeat the operation. Deleting the installation does not repair Docker image references. Older bundles without portable image tags must be replaced with a newly exported bundle. Installed `verify` checks release files; it does not send model requests or verify cloud behavior.
