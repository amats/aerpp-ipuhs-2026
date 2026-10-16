# Contributing to admin

Follow the [workspace principles](../../CONTRIBUTING.md) and [README](README.md). Use Node.js 24 and the root pnpm version and lockfile.

## Development

Admin uses Node.js only. Install `unzip` for independent archive tests. See [data export](docs/data-export.md#runtime-and-checks).

Install dependencies at the workspace root with `pnpm install --frozen-lockfile`. Configure shared private settings using the [configuration guide](../../docs/configuration.md). Use the managed launch in [README](README.md#configuration-and-local-development).

Run `pnpm run check:admin` from the root. It includes Biome, route type generation, TypeScript, and Vitest. Root `pnpm run build` includes `pnpm run build:admin`, which delegates to Admin’s `build:local` and uses no bundled questionnaires and isolated synthetic settings without an authentication bypass. Use the selected private profile when verifying environment-specific distribution behavior. These checks do not establish real OAuth, Firestore, or Cloud Logging behavior.

Run `pnpm run test:e2e:admin` for browser flows against isolated Firestore. It reuses the Support emulator launcher and runs a loopback development server with synthetic authentication bypass. Scenarios cover notice CRUD, stale edits, deletion and draft-discard confirmation, draft retention across navigation and failed saves, mobile layout and focus handling, readable empty/populated participant tables with keyboard scrolling, wrapped recovery identifiers/reasons and participant summaries before verification/recovery forms, separate exports with decrypted contact email, download progress/failure/retry/cancellation, all-purpose retention and research/contact separation, operational status with period/purpose retention, fixed server scope, separate unavailable logs, observed attempt outcomes and keyboard/mobile tables, survey response counts without version matching or numeric-range assumptions, empty and populated attempt tables, and analysis-time histograms across purpose filters and reloads. Root `verify:local` and `verify:release` include this suite. These synthetic checks do not verify real OAuth or cloud IAM.

Participant form scenarios cover repeated email/PID lookups, repeated consent/withdrawal DID verification and invalidation when inputs change. Notice scenarios verify that validation rejection, failed delivery and stale edits retain the selected tone, while an accepted save clears the draft.

## Ownership

- `src/app`: routes, layouts, and API handlers.
- `src/features`: feature data loading and presentation.
- `src/features/monitoring`: shared participant/survey records, operational summaries and the recent-activity list used by participant and survey pages. Pages retain their own loading and filtering.
- `src/features/information`: environment-wide notice management, authenticated Server Actions and forms. Its client provider owns the in-memory draft, dirty-state confirmation, pending operation and feedback across navigation; shared persistence lives in `@aerpp/firestore`.
- `src/features/log`: operational status, retained-record usage trends, safe event classification and attention summaries shared with the dashboard; Cloud Logging transport remains in `src/lib`.
- `src/features/participant`: authenticated document binding checks, PID history lookup and reviewed recovery authorization.
- `src/features/research`: full research and participant-access exports. Source reads and pure file generation remain separate; tests are colocated, with shared synthetic fixtures in `test-support`.
- `src/features/app-shell`: authenticated `AppShell`, `AppHeader`, `AppFooter`, navigation and the fixed environment server indicator. Header sign-out uses the notice feature's discard guard. Pages compose the shell so it receives fresh search parameters; the root layout mounts the authentication and notice-draft providers and owns body styles.
- `src/ui`: reusable presentation components.
- `MainContentLayout`, `CardSection`, `CardPanel`, `SectionHeading` and `ui-styles` follow Web's naming and visual structure. Keep Admin's green theme and presentation tokens local; authentication and data loading do not belong in `src/ui`.
- `src/lib`: authentication, Firestore, and Cloud Logging infrastructure. `firestore.ts` owns the server-only Google Cloud Firestore client. `@aerpp/firestore` owns shared references, queries, raw research snapshot projections and storage value conversion; Admin retains filters, questionnaire definitions and export authorization.
- `@aerpp/config/server/admin`: server-only runtime environment parsing, defaults and validation.
- `src/proxy.ts`: route protection.
- Survey definitions remain application inputs; do not alter questionnaires during infrastructure maintenance.

Follow [workspace coding conventions](../../docs/coding-conventions.md#style-and-naming), [shared Next.js rules](../../docs/nextjs.md), [shared code organization](../../docs/code-organization.md) and [monitoring contracts](docs/monitoring.md) and [notice contracts](docs/information.md).

## Review

Keep app identity and the root description in `src/app/manifest.json`; the root layout reuses these values and applies the `%s | ADMIN-AERPP` title template. Page titles omit the application suffix and provide Japanese descriptions of the actual operation. The manifest uses `/` for its stable `id`, `start_url` and `scope`; the landing route redirects to the dashboard.

Manifest PNG icons belong in `public/`; their exact URLs must bypass authentication in `src/proxy.ts`. Keep `favicon.ico`, `icon.svg` and `apple-icon.png` in `src/app/` for automatic Next.js metadata. Do not exempt arbitrary image extensions or path prefixes from authentication. Preserve the green UI palette, use `--brand-solid` with `--brand-on-solid` for filled controls, and reserve `--brand` for text and accents. The manifest keeps a white launch background while root viewport metadata supplies light/dark browser theme colors.

Prioritize authentication boundaries, query and aggregation correctness, filter behavior, environment fallbacks, and documentation. For authentication changes, verify both normal login and development-only bypass. For data changes, check filtered and unfiltered views.

Follow [workspace branch/evidence rules](../../CONTRIBUTING.md#branches-and-evidence). Regenerate license notices when production dependencies change.
