import { throwApiError } from "./api-errors.js"
import type { readParticipationState } from "./participant-state.js"

type State = Awaited<ReturnType<typeof readParticipationState>>
type Owner = { clientId: string; serverId: string; analysisId?: string }

// Study eligibility is initialized and advanced by the current consent/analysis
// transactions. Accepted initial answers end the initial flow; counts and browser
// result availability are never eligibility evidence. Session reset preserves it.
export function readStudyParticipation(state: State) {
  return state.data.studyStatus === "follow-up"
    ? { kind: "follow-up" as const, initial: null }
    : { kind: "initial" as const, initial: state.data.initialAnalysis ?? null }
}

export function assertStudyBrowser(
  study: ReturnType<typeof readStudyParticipation>,
  owner: Owner,
) {
  if (
    study.initial &&
    (study.initial.clientId !== owner.clientId ||
      study.initial.serverId !== owner.serverId)
  )
    throwApiError(
      409,
      "INITIAL_BROWSER_REQUIRED",
      "use the initial analysis browser until survey acceptance",
    )
}

export function assertStudyAnalysis(
  study: ReturnType<typeof readStudyParticipation>,
  owner: Owner,
) {
  assertStudyBrowser(study, owner)
  if (study.initial && study.initial.analysisId !== owner.analysisId)
    throwApiError(
      409,
      "INITIAL_ANALYSIS_LOCKED",
      "initial survey or researcher authorization required",
    )
}
