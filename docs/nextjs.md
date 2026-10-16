# Next.js development

Apply to both Web and Admin. Read the affected app's contributor and architecture guides for its authentication, data and state contracts. Paths beginning with `src/**` refer to that app; run commands from the workspace root, preferring the maintained root entrypoints in [development](development.md#workspace-commands). These shared conventions do not make either app's services or helpers available to the other.

## Framework and code boundaries

- Before writing framework code, read the relevant installed guide under the affected app's `node_modules/next/dist/docs/`. Resolve Next.js from that app, not the workspace root. Preserve the framework-managed block in each app's AGENTS.md.
- Use [shared code organization](code-organization.md) when choosing ownership, definitions or imports.
- Follow [shared comments](coding-conventions.md#comments) and [boolean decisions](coding-conventions.md#boolean-decisions), including explicit success checks on awaited function results and structured result fields.
- Keep framework contract exports such as `metadata`, `dynamic`, `config`, `GET` and `POST` in the framework-required form.

## Server Functions and cookies

- Files defining React Server Functions must start with `actions-`; their function names must end with `Action`.
- Client components may call exported Server Functions as interaction boundaries. Do not call one exported action from another; put reusable server logic in service/helper modules and call it from each boundary.
- Server Components may read cookies but must not save or destroy sessions while rendering. Cookie mutations belong in Server Functions or Route Handlers. Follow the owning app's session/authentication implementation rather than copying one app's session model to the other.

## Validation and failure handling

- Validate external I/O at route, action, script and integration boundaries before passing values deeper into feature logic. Type assertions do not replace runtime parsing.
- Handle expected failures locally as results, HTTP responses/statuses or UI error states, including in Server Components and client code. Reserve application exceptions for unexpected failures.
- Preserve framework control flow: do not swallow `redirect()` or `notFound()` in an application error handler. Keep those calls outside broad `try`/`catch` blocks.
- Log at the owning operation boundary using the app's existing structured logger and the [workspace logging rules](coding-conventions.md#logging-and-privacy). Lower-level helpers return safe failure metadata for that boundary; do not import Web's logger into Admin or pass raw SDK errors to an unredacted logger.

## Environment and development-only behavior

- Centralize server runtime settings, required/optional contracts and defaults in `@aerpp/config`. Web imports `@aerpp/config/server/web`; Admin imports `@aerpp/config/server/admin`. These [server entrypoints](../packages/config/README.md) enforce `server-only` and parse injected settings once per module instance. Do not restore app-local env modules or read `process.env.*` directly in features and pages.
- Keep runtime validation aligned with `@aerpp/config` and the shared JSON templates. Client build-time values such as `NEXT_PUBLIC_*` remain distinct from server runtime settings. Use [shared configuration guidance](configuration.md) for configuration or startup changes.
- Development-only preview, inspection and debug routes must return `notFound()` in production. Retain the shared debug layout guard and check availability at each page entry before server reads. Where an outer layout streams, reject disabled routes at the request boundary too so the HTTP status remains 404. Control availability through the matching config server entrypoint.
- Keep debug output free of the sensitive data listed in the [workspace logging rules](coding-conventions.md#logging-and-privacy), including real credentials. Do not add production runtime fallbacks solely to support debug pages.
- These rules apply when adding such routes; they do not require Admin to acquire Web's debug pages or either app to acquire the other's authentication bypass.

## Rendering optimization

Web and Admin enable the stable React Compiler for automatic component memoization. Keep the compiler dependency in the shared catalog. Memoization is a rendering optimization; session authority and mutation guards must remain independent of it. Run the production build and the owning browser suite after changing compiler settings.

## Verification

Follow the [workspace verification requirements](../CONTRIBUTING.md#before-opening-a-pr) and [local verification](development.md#first-run-without-cloud-credentials). Select the affected app's checks; route/framework/build changes also require the applicable build. Report browser and external-service behavior separately from local checks.
