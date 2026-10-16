"use server"

import { randomUUID } from "node:crypto"
import { readStepStateFromSession } from "@/features/app-context/step-state-session"
import { createLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import {
  type AppSession,
  getSession,
  getSessionToken,
  pruneSessionCookies,
  renewSessionCookie,
} from "@/lib/session"
import { readAnalysisOperation, readAuthority } from "@/lib/session-authority"
import { isSessionGeneration } from "@/lib/session-generation"

// Admission shares a browser session, never a tab owner. Unavailable browser
// credentials recover to fresh authentication; Firestore study history survives.
// A claimed generation ID never authorizes revoking another browser's authority.
export async function admitSessionAction(scope: string) {
  if (isSessionGeneration(scope) !== true)
    return { ok: false as const, reason: "session_invalid" }
  try {
    let recovered = false
    let session: AppSession
    try {
      session = await getSession(scope)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["session_invalid", "session_snapshot_unavailable"].includes(
          error.message,
        )
      )
        throw error
      const current = readAuthority(scope)
      if (
        current?.busy ||
        (current?.revision === 1 && current.updated > Date.now() - 10_000)
      )
        throw new Error("session_admission_pending")
      const alreadyCreated = await getSession()
      if (
        alreadyCreated.coordinationId &&
        alreadyCreated.coordinationId !== scope
      ) {
        scope = alreadyCreated.coordinationId
        session = alreadyCreated
      } else {
        scope = randomUUID()
        session = await getSession(scope)
        recovered = true
      }
    }
    if (!session.coordinationId) {
      const existing = await getSession()
      if (existing.coordinationId) {
        scope = existing.coordinationId
        session = existing
      }
      session.coordinationId = scope
      await session.save()
    }
    let analysisStatus = session.lastCompletedAnalysisId ? "completed" : "idle"
    if (session.activeAnalysisId) {
      const status = readAnalysisOperation(scope, session.activeAnalysisId)
      analysisStatus =
        status === "failed" || status === "cancelled"
          ? status
          : status === "running" || status === "completed"
            ? "running"
            : "unconfirmed"
    }
    await pruneSessionCookies(scope)
    await renewSessionCookie(scope)
    return {
      ok: true as const,
      analysisStatus,
      stepState: await readStepStateFromSession(session),
      scope,
      sessionToken: getSessionToken(scope),
      recovered,
      recoveredSurveyAnalysisId: session.recoveredSurveyAnalysisId,
      recoveryRequired: session.adminRecoveryCleanupPending === true,
    }
  } catch (error) {
    createLogger({
      component: "session",
      operation: "admission",
    }).error({ event: LOG_EVENT.sessionGetFailed, error })
    return {
      ok: false as const,
      reason:
        error instanceof Error && error.message === "session_admission_pending"
          ? "session_admission_pending"
          : "admission_failed",
    }
  }
}
