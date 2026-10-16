# Shared configuration

This package owns explicit environment selection, secret references, runtime readers and managed process isolation. See [configuration](../../docs/configuration.md) and [environments](../../docs/environments.md).

The package root and web/admin/support readers are pure. server/web and server/admin enforce server-only for Next.js. workspace, targets and process own Node-only loading and child-process isolation. Public example settings are local-only; test and production use separate private project/operator configuration and credentials.

The `llm` and `survey` path helpers resolve shared application inputs under [config/common](../../config/common/README.md) from Web working directories, including standalone outputs. Questionnaire files are independent of environment selection.

The Support configuration projects runtime settings from secret.json and applied Terraform identities. Web requires only its Support origin/caller credential and its own secrets. No startup performs cloud discovery or mutates infrastructure. Terraform inputs contain only explicit non-secret configuration and immutable deployment references.

Run pnpm run check:config from the workspace root. Keep .d.mts declarations and process-boundary tests aligned with implementation.

The `questionnaire` export owns JCS identity, archive path validation and the project-derived bucket name. Admin fetches archived definitions only for research ZIPs. No extra environment-specific bucket setting is required.

The Node-only `document-set` export owns exact-byte PDF/MDX manifests, references, verification and project-derived archive paths. [Document sets](../../docs/document-sets.md) describes deployment pinning and retention; Firestore has no document-set registry.
