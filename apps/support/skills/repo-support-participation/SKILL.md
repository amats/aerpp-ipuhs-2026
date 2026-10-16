---
name: repo-support-participation
description: Use when changing Support authentication, consent, email resend, exact retries, withdrawal, cleanup, analysis observations, administrator recovery or participant data-purpose classification.
---

# Support participation

Follow [Support instructions](../../AGENTS.md). Source paths are relative to Support; commands run from the workspace root. Read only the persistence sections matching the changed behavior.

| Changed behavior | Canonical contract |
| --- | --- |
| Storage access, authorization and transaction retries | [Ownership and transactions](../../docs/persistence.md#ownership-and-transactions) and [shared Firestore boundaries](../../../../packages/firestore/README.md#participant-references-and-queries) |
| Token issuance, email resend, confirmation and expiry | [Authentication](../../docs/persistence.md#authentication) and [consent/receipt timestamps](../../docs/persistence.md#consent-and-receipt-timestamps) |
| Withdrawal, overlapping cleanup, deadlines and renewed participation | [Withdrawal](../../docs/persistence.md#participation-and-withdrawal) and [renewed consent](../../docs/persistence.md#renewed-consent) |
| Administrator grants, recovered questionnaires or study-generation fences | [Administrator recovery](../../docs/persistence.md#administrator-recovery) and [operator destinations](../../../../docs/study-operations.md#administrator-selected-recovery-destinations) |
| Survey writes and response-loss retries | [Exact survey retries](../../docs/persistence.md#exact-survey-retries) |
| Analysis starts/completions and immutable observations | [Analysis observations](../../docs/persistence.md#analysis-observations) |
| Test-account classification and inherited purpose | [Server-owned data purpose](../../docs/persistence.md#server-owned-data-purpose) |
| Schema, indexes or retention changes | [Indexes/retention](../../docs/persistence.md#indexes-and-retention) and [coordinated updates](../../docs/persistence.md#coordinated-updates) |

Keep request schemas, validators, OpenAPI and consumers aligned when a boundary changes. Preserve the owning transaction, exact retry identity and history/deadline fences; do not relocate participation policy into generic shared CRUD helpers. See [participant contracts](../../../../packages/contracts/README.md).

Apply the shared [transaction design and review procedure](../../../../docs/architecture.md#design-and-review-procedure) when changing these commitments. Trace transaction-callback retries separately from caller response-loss retries, and distinguish accepted facts from mail delivery and durable cleanup. Review equivalent request handlers when an interruption defect exposes a shared boundary.

Select validation through [repo-testing](../../../../skills/repo-testing/SKILL.md) and [Support local verification](../../README.md#local-verification). Cover concurrent requests and response-loss/retry behavior when those contracts change. Real cloud, OAuth and mail evidence remains separate from synthetic verification.
