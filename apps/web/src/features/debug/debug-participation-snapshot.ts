import "server-only"

import { z } from "zod"
import { readStepStateFromSession } from "@/features/app-context/step-state-session"
import { analysisIdSchema } from "@/features/llm/analysis-receipt-types"
import {
  readLastCompletedAnalysisIdFromSession,
  readSubmittedAnalysisIdFromSession,
} from "@/features/llm/analysis-session"
import type { AppSession } from "@/lib/session"

// Inspect local authority without mutating it or exposing participant IDs.
export async function readParticipationDebugSnapshotFromSession(
  session: AppSession,
) {
  const stepState = await readStepStateFromSession(session)
  const kind = z
    .enum(["initial", "follow-up"])
    .safeParse(session.questionnaireKind)
  const completed = readLastCompletedAnalysisIdFromSession(session)
  return {
    stage: stepState.stage,
    rootStep: stepState.step,
    questionnaireKind: kind.success === true ? kind.data : null,
    surveyAccepted:
      completed !== null &&
      readSubmittedAnalysisIdFromSession(session) === completed,
    recoveredSurvey: analysisIdSchema.safeParse(
      session.recoveredSurveyAnalysisId,
    ).success,
  }
}
