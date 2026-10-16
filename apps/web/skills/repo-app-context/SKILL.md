---
name: repo-app-context
description: Use when changing Web AppContext orchestration, StepState transitions or analysis, consent, survey, withdrawal and reset flows.
---

# Web app flow and step state

Follow [Web instructions](../../AGENTS.md). Source paths are relative to `apps/web`; commands run from the workspace root. Read only the contracts matching the change:

| Changed boundary | Read next |
| --- | --- |
| Intent ownership or transition rules | [Flow ownership](../../docs/architecture.md#app-flow-ownership) and [transition map](../../docs/architecture.md#stepstate-transition-map) |
| Admission, operation fences, analysis observation or result restoration | [Browser coordination](../../docs/analysis-coordination.md) |
| Consent, surveys, withdrawal, receipts or cleanup | [Participation](../../docs/participation.md) |
| Retry, reload, output loss or reset | [Recovery decisions](../../docs/recovery.md), [browser coordination](../../docs/analysis-coordination.md) and [session authority](../repo-session/SKILL.md) |
| Administrator recovery | [Selected destinations](../../../../docs/study-operations.md#administrator-selected-recovery-destinations) and [session authority](../repo-session/SKILL.md) |

Apply `repo-session` whenever the change reads or persists session values, prepares retries or changes cookies.

## Guidance

- For flows crossing SQLite, Support, browser state or optional document delivery, apply the shared [transaction design and review procedure](../../../../docs/architecture.md#design-and-review-procedure) before changing orchestration. Trace accepted and unconfirmed states through the service and provider; keep delivery failure separate from the accepted transition.
- Keep `src/features/app-context/actions-step-state.ts` intent-only and thin, importing intents only from `step-state-transition-service.ts`. Never expose arbitrary `StepState` persistence. The server derives approved states; the provider adopts them.
- Follow the documented service/core/provider ownership. Keep flow-ordered intent rules and external effects in the service, shared mechanics in the core, and browser orchestration in the provider. Do not split by intent or workflow without genuinely independent ownership.
- Preserve the service's responsibility/invariant comment and the local responsibility comments in `actions-step-state.ts`, `app-context-provider.tsx` and `step-state-session.ts`; update them when the described boundary changes. Keep the architecture transition map aligned with changed intents/allowed states.
- Use `readStepStateFromSession(session)` for validated/normalized persisted state and `readInitialStepState()` for root rendering. Admission and mutating intents own persistence; rendering must not save cookies.
- Persist business transitions, keeping `startSurvey` and `returnToResult` as validated tab-local views without shared screen writes. `submittedAnalysisId` owns submission status independently of navigation.
- Treat upstream-confirmed withdrawal as terminal even if session persistence fails. Return the server-derived withdrawn state with a separate persistence warning so the client stops participation and offers retry.
- Every committed transition into unauthenticated or withdrawn state must clear authentication proof (`authVerifiedAt`) and active/completed analysis identifiers, including normalized recovery paths.
- Transitions into authenticated or follow-up flow states must use the local authentication guard. Authentication preparation first verifies upstream authentication and then applies that guard. Withdrawal uses its own upstream withdrawal check and commits the terminal withdrawn state.

## Verification

Use [repo-testing](../../../../skills/repo-testing/SKILL.md) for the changed boundary. Cover rejected state, missing local authentication proof, persistence failure and successful transitions near the flow files. Extend `actions-step-state.test.ts` for new simple intents and the exhaustive `step-state-validation.test.ts` matrix for new stages/root steps.
