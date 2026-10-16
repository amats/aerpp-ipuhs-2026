---
name: repo-admin-data
description: Use when changing Admin participant monitoring, recovery lookup/authorization, survey aggregation, questionnaire loading or research/access exports.
---

# Admin participant data

Follow [Admin instructions](../../AGENTS.md). Source paths are relative to `apps/admin`; pnpm commands run from the workspace root. Read only the contracts matching the change:

| Changed boundary | Read next |
| --- | --- |
| Operational counts, submission status or initial/follow-up grouping | [Aggregation semantics](../../docs/monitoring.md#survey-aggregation) |
| Participant scope, withdrawal status or data purpose | [Research/test filters](../../docs/monitoring.md#research-and-test-data) and [read projections](../../docs/monitoring.md#read-ownership-and-projections) |
| Questionnaire validation, identity or retrieval | [Questionnaire inputs](../../../../docs/examples.md#questionnaire-definitions) and [archive retrieval](../../docs/data-export.md#research-fields) |
| Recovery lookup, record review or authorization | [Researcher recovery](../../docs/monitoring.md#researcher-recovery) and [selected destinations](../../../../docs/study-operations.md#administrator-selected-recovery-destinations) |
| Research/access downloads or export fields | [Complete source scope](../../docs/data-export.md#complete-source-export), [file formats](../../docs/data-export.md#files-and-formats), [research fields](../../docs/data-export.md#research-fields) and [access fields](../../docs/data-export.md#participation-and-activity-fields) |

## Implementation boundaries

- Apply the shared [transaction design and review procedure](../../../../docs/architecture.md#design-and-review-procedure) for recovery authorization and exports. Keep an accepted recovery grant distinct from its acknowledgement, and optional export delivery distinct from participant mutations. Review both server waits and browser pending-state recovery when changing downloads.
- Keep monitoring as fresh load/reload operational counts. Research eligibility, scoring and accurate aggregation belong offline; do not add polling/subscriptions or infer missing attempts/consent bindings. Resolve selected participants' latest status across server/purpose filters as documented.
- Distinguish attempts, completed-analysis metadata and submitted answers. Require valid `submittedAt` for response/respondent counts; starts without terminal observations remain unconfirmed. Use recorded attempts for initial/follow-up grouping, never `surveyVersion`. Show item IDs/counts without averages.
- Require a nonempty string `survey_version` in definitions without trimming, format or equality checks. Fetch canonical hash-addressed definitions only for research ZIPs, never monitoring/startup/builds or standalone JSON/CSV/access downloads. Missing/corrupt referenced definitions abort export; preserve `reverse` metadata.
- Keep recovery lookup request-only and grant authorization guarded by exact Firestore versions. Support owns consumption after fresh consent/email confirmation; preserve original provenance and distinguish presentation permission from actual viewing.
- Export research records across purposes, servers and dates after excluding closed withdrawal periods in the same snapshot, including pending cleanup. Preserve access history across withdrawal. Do not reconstruct research durations from operational timestamps. Keep research and access downloads separate with their canonical field projections, linkage and read/exported counts. Decrypt retained email only for access export; preserve absent/null/empty values and unreadable rows (`email: 復号できません`, consent/withdrawal `did: null`). Never export ciphertext/credentials or fabricate events/purposes.

## Verification

Select checks through [repo-testing](../../../../skills/repo-testing/SKILL.md). Implementation changes need `pnpm run check:admin`; changed views/downloads also need the [isolated browser scenarios](../../CONTRIBUTING.md#development). Check filtered/unfiltered monitoring and full source-export scope separately. Report real OAuth, Firestore and Cloud Logging behavior separately from synthetic evidence.
