import "server-only"

import { analysisIdSchema } from "@/features/llm/analysis-receipt-types"
import type { AppSession } from "@/lib/session"

export function readLastCompletedAnalysisIdFromSession(
  session: AppSession,
): string | null {
  const parsedAnalysisId = analysisIdSchema.safeParse(
    session.lastCompletedAnalysisId,
  )
  return parsedAnalysisId.success ? parsedAnalysisId.data : null
}

export function readActiveAnalysisIdFromSession(
  session: AppSession,
): string | null {
  const parsedAnalysisId = analysisIdSchema.safeParse(session.activeAnalysisId)
  return parsedAnalysisId.success ? parsedAnalysisId.data : null
}

export function clearAnalysisStateFromSession(session: AppSession) {
  delete session.recoveredSurveyAnalysisId
  delete session.submittedAnalysisId
  delete session.pendingSurveyAnalysisId
  delete session.activeAnalysisId
  delete session.presentedAnalysisId
  delete session.lastCompletedAnalysisId
}

export function readSubmittedAnalysisIdFromSession(
  session: AppSession,
): string | null {
  const parsed = analysisIdSchema.safeParse(session.submittedAnalysisId)
  return parsed.success ? parsed.data : null
}
