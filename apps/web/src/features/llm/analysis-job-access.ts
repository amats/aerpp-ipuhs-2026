import "server-only"

import { Stage } from "@/features/app-context/stage-types"
import {
  isLocallyAuthenticated,
  readLocalAuthenticationFromSession,
} from "@/features/auth/auth-session"
import { type AppSession, getSessionForTab } from "@/lib/session"
import {
  isAnalysisExecutionAbandoned,
  readAnalysisOperation,
} from "@/lib/session-authority"
import {
  cancelMemoryAnalysisJob,
  readMemoryAnalysisJob,
  readMemoryAnalysisResult,
} from "./analysis-job-registry"
import type { AnalysisJobOwner, AnalysisJobStatus } from "./analysis-job-types"
import {
  readActiveAnalysisIdFromSession,
  readLastCompletedAnalysisIdFromSession,
} from "./analysis-session"

export async function readAnalysisJobAccess(token: unknown) {
  return readAnalysisJobAccessFromSession(await getSessionForTab(token))
}

async function readAnalysisJobAccessFromSession(session: AppSession) {
  const authentication = await readLocalAuthenticationFromSession(session)
  if (
    isLocallyAuthenticated(authentication) !== true ||
    !authentication?.clientId ||
    !authentication.pseudonym ||
    !session.consentId ||
    !session.coordinationId
  )
    throw new Error("session_invalid")
  const owner: AnalysisJobOwner = {
    sessionId: session.coordinationId,
    clientId: authentication.clientId,
    pseudonym: authentication.pseudonym,
    consentId: session.consentId,
  }
  const analysisId =
    readActiveAnalysisIdFromSession(session) ??
    readLastCompletedAnalysisIdFromSession(session)
  return { session, owner, analysisId }
}

export async function cancelAnalysisJobFromSession(session: AppSession) {
  const { owner, analysisId } = await readAnalysisJobAccessFromSession(session)
  if (analysisId) await cancelMemoryAnalysisJob(analysisId, owner)
  return readAnalysisJobStatusFromSession(session)
}

export async function readAnalysisJobStatusForTab(
  token: unknown,
): Promise<AnalysisJobStatus> {
  return readAnalysisJobStatusFromSession(await getSessionForTab(token))
}

export async function readAnalysisJobStatusFromSession(
  session: AppSession,
): Promise<AnalysisJobStatus> {
  const { owner, analysisId } = await readAnalysisJobAccessFromSession(session)
  if (!analysisId)
    return {
      ok: true,
      analysisId: null,
      status: "idle",
      startedAtMs: null,
      elapsedMs: null,
    }
  const memory = readMemoryAnalysisJob(analysisId, owner)
  const participation =
    session.questionnaireKind === "initial" ||
    session.questionnaireKind === "follow-up"
      ? { questionnaireKind: session.questionnaireKind }
      : {}
  if (memory) return { ...memory, ...participation }
  const recorded = readAnalysisOperation(owner.sessionId, analysisId)
  const unavailable =
    recorded === "completed" ||
    session.lastCompletedAnalysisId === analysisId ||
    (recorded !== "failed" &&
      recorded !== "cancelled" &&
      isAnalysisExecutionAbandoned(owner.sessionId, analysisId) === true)
  return {
    ...participation,
    ok: true,
    analysisId,
    startedAtMs: null,
    elapsedMs: null,
    canRecover:
      unavailable === true &&
      (session.stage === Stage.authenticated ||
        session.stage === Stage.followUp) &&
      (session.stage === Stage.followUp ||
        session.presentedAnalysisId !== analysisId),
    status:
      unavailable === true
        ? "unavailable"
        : recorded === "failed" || recorded === "cancelled"
          ? recorded
          : "unconfirmed",
  }
}

export async function readAnalysisJobResultForTab(
  token: unknown,
  expectedAnalysisId: string,
) {
  const { owner, analysisId } = await readAnalysisJobAccess(token)
  if (analysisId !== expectedAnalysisId) throw new Error("analysis_mismatch")
  return readMemoryAnalysisResult(analysisId, owner)
}
