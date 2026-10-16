# Support agent instructions

Inherit [workspace guidance](../../AGENTS.md). [README](README.md) owns runtime/verification procedures; [persistence](docs/persistence.md) owns participation state and transactions.

## Authorization and ownership

- Validate bearer credentials by stored verifier, environment, validity, revocation, exact operation and server identity. Caller credentials do not replace participant ownership or confirmed consent. Pending email authentication never authorizes withdrawal; unknown routes default to no handler.
- Use `@google-cloud/firestore` and Google OIDC through the existing adapters. Reuse `@aerpp/firestore` through request-scoped storage; Support retains authorization and write transactions. Never cache the selected repository across requests.
- Apply `repo-support-participation` when changing authentication, consent, resend/retry, withdrawal, cleanup, analysis observations, administrator recovery or data-purpose classification.

## Runtime and privacy

- Read settings through `@aerpp/config/support`. Reject missing/mixed targets and emulator/cloud mail combinations. Keep test and production projects, credentials and state independent.
- Keep document bodies/results, email addresses/ciphertexts, tokens, headers, raw SDK exceptions and request URLs out of logs. Use the app's structured logger with fixed operation/code fields and aggregate counts.
- Real Gmail recipients must match the selected web.nextPublicParticipantEmailPattern. Local tests use synthetic mail with no cloud fallback. Token refresh/rotation and real-mail acceptance are explicit operations.
- For changed deployment/runtime boundaries, apply the shared configuration skill and [deployment guide](../../docs/deployment.md).

## Verification and task-specific skills

Use `repo-testing` and the [verification matrix](../../docs/development.md#verification-by-change) to select checks. `pnpm run check:support` owns static/unit/build verification; participation and storage changes also require applicable contract/emulator checks. Documentation or development-tool changes alone do not require cloud deployment.

- `repo-support-participation`: [authentication, consent, retry, withdrawal, cleanup and administrator recovery](skills/repo-support-participation/SKILL.md) for changes to participant requests, records and maintenance.
