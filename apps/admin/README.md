# AERPP administrator application

This independent Next.js application reads participant consent, analysis attempts, surveys, stored authentication records, and Google Cloud Logging data. Its intended deployment is Cloud Run in a project authorized to access those services. It is not part of the operational Mac's Compose stack.

Firestore operations use `@google-cloud/firestore` through the server-only [client adapter](src/lib/firestore.ts). Local development impersonates a Terraform-managed service identity through the selected gcloud operator account; hosted deployments use their runtime service identity through ADC. NextAuth owns authentication; the adapter preserves timestamp precision.

Admin is an operational monitor: each page load or reload reads the current Firestore data; realtime subscriptions and automatic refresh are not required. Its counts are temporary, simplified displays for operational reference; accurate research aggregation is outside their scope. For accurate aggregation and analysis after the Support reception deadline, export the retained source data, select the appropriate records according to the study's criteria, and aggregate that selection offline.

The header's **リロード** button reloads the current page with its URL filters retained. Unsaved notice changes trigger the browser's leave-page confirmation; accepting the reload clears those changes.

## Pages

- `/dashboard`: participant and survey summaries, grouped operational attention items, and participant/response history.
- `/participant`: participant status from consent records.
- `/survey`: separate attempt/outcome, completed-analysis, submitted-response and per-item response counts, an analysis-time histogram, and record lists.
- `/research`: separate full research and participant-access exports for offline verification and analysis. See [data export](docs/data-export.md).
- `/information`: environment-wide notice creation, editing and deletion.
- `/updates`: participant and survey activity for the selected data purpose and configured server.
- `/log`: operational status with retained-record usage counts and daily trends, grouped attention items, latest scheduled-maintenance results, and classified operational events. See [monitoring contracts](docs/monitoring.md#cloud-logging).
- `/license`: application and dependency notices.
- `/`: redirects to `/dashboard`.

Operational views use the fixed `shared.participantApiServerId` from the selected environment, projected as required `PARTICIPANT_API_SERVER_ID`. The header displays this value; there is no server selector. URL parameters cannot override it. Source exports include all servers within the selected environment. Missing, blank or `all` values are rejected. The operational status page shares the 1/7/30-day window across usage and logs. Data-purpose and fixed-server filters apply only to Firestore usage; operational logs and maintenance cover the environment. Application dependencies and exact versions are recorded in [package.json](package.json) and the root lockfile.

The layout follows Web's responsive spacing, card hierarchy and content width, with a green Admin header. The current page and reload action remain visible. Below 1024px, “メニュー・環境情報” expands the navigation; navigating to another page closes it. “アカウント・環境情報” exposes the account, sign-out action, fixed server ID and reception deadline. Header and footer navigation retain the selected data purpose, which stays visible above operational views. The filter's scope is summarized alongside a disclosure with the export explanation.

At 1280px and above, notice editing and the notice list appear side by side, as do the separate research/access export cards; narrower screens stack them. Simple form controls use a bounded width, while record tables retain the full content width and scroll within their cards. The participant page starts with summary counts and recent updates, followed by document verification, recovery lookup, authorization history and the consent history table. Participant history tables keep headings and dates on one line and support keyboard scrolling; recovery records wrap complete identifiers and reasons within their cards. Survey records precede separate initial/follow-up item-summary cards. License pages have section links and alphabetically grouped dependency disclosures with complete notice texts. See the [ownership map](CONTRIBUTING.md#ownership) for component responsibilities.

## Authentication

Google OAuth uses NextAuth.js. Only addresses listed in `ADMIN_ALLOWED_EMAILS` may sign in. [src/proxy.ts](src/proxy.ts) protects routes; the [auth route](src/app/api/auth/[...nextauth]/route.ts) handles NextAuth requests.

Sign-in also requires Google's `email_verified` claim to be exactly `true`. Protected requests and server session checks recheck the email allowlist, including for existing sessions. The allowlist is loaded at process startup: after removing an address, apply the updated configuration and restart or redeploy all serving instances, retiring old revisions. Subsequent protected requests are denied even if the browser still holds a valid session cookie. This does not erase already displayed data or cancel requests already in progress; adding the address again can allow an unexpired session to work again.

`ADMIN_AUTH_BYPASS_ENABLED=true` bypasses sign-in only with `NODE_ENV=development`, `AERPP_ENVIRONMENT=example`, a `demo-` project and a loopback Firestore emulator, without a cloud impersonation identity. Use the literal strings `true` or `false`; an unset or empty flag disables bypass. Other flag values are rejected. Do not use bypass as a production configuration.

## Configuration and local development

After completing the [test setup](../../docs/setup.md), use [shared configuration](../../docs/configuration.md) and the [environment guide](../../docs/environments.md). [Editable examples](../../config/example/README.md) document OAuth, access-control and credential settings; `GCP_PROJECT_ID` is derived from the selected configuration. Shared launches reject the development auth bypass and app-local dotenv files.

To check a fresh clone without cloud credentials, use the root synthetic build and [isolated browser scenarios](../../docs/development.md#first-run-without-cloud-credentials), or generate the [synthetic export sample](docs/data-export.md#synthetic-sample). There is no `example` Admin launch configuration for interactive Google login.

```sh
pnpm run env:run test admin dev
```

Commands run from the workspace root. Development OAuth uses `http://localhost:3001/api/auth/callback/google`; preserve production callback settings. Validate with `pnpm run check:admin` and build using the selected configuration. See [contributor guidance](CONTRIBUTING.md).

Google OAuth credentials control sign-in; Google Cloud credentials authorize Firestore/Logging access. Local launches derive the selected operator and service identity from the configuration and request short-lived tokens through gcloud. Cloud Run uses its assigned service account/ADC. Admin rejects credential files and inline private keys. Changing credential method requires verification; a server filter does not restrict IAM access.

Build the Admin Docker image locally with `pnpm run admin:build-image test`, then run `pnpm run admin:check-image test`. The workspace owns provisioning, OAuth import, deployment plans and explicit Cloud Run deployment; follow [Admin delivery](../../docs/deployment.md#admin-cloud-run-delivery). Real OAuth and cloud access acceptance remain separate from image checks.

The common Admin header displays both **Web受付終了日時** and **Support終了日時** in Japan time (`Asia/Tokyo`, UTC+09:00), including seconds. It uses `support.access.expiresAt` and the independent `support.access.backendStopsAt` through the derived `SUPPORT_RECEPTION_EXPIRES_AT` and `SUPPORT_BACKEND_STOPS_AT` runtime settings. Both deadlines are informational in Admin: data reads and exports remain available afterward. Apply the updated Admin runtime when changing these settings.

## Documentation

| Purpose | Guide |
| --- | --- |
| Shared setup, targets, configuration and deployment | [Workspace documentation](../../docs/README.md) |
| Operational counts, filters, timestamps and log views | [Monitoring](docs/monitoring.md) |
| Notice editing, concurrent updates and drafts | [Information management](docs/information.md) |
| Separate complete research and participant-access exports | [Data export](docs/data-export.md) |
| Source ownership, checks and review | [Contributing](CONTRIBUTING.md) |
