import "server-only"

import { Stage } from "@/features/app-context/stage-types"
import { ID_CONSTRAINTS } from "@/features/identity/id-constraints"
import { generateRandomIdSuffix } from "@/features/identity/random-id"
import type { AppLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import type { AppSession } from "@/lib/session"
import { sessionOperation, setAnalysisOperation } from "@/lib/session-authority"
import { type AnalysisAttempt, beginAnalysisAttempt } from "./analysis-attempt"
import { reserveAnalysisJob } from "./analysis-job-registry"
import type { AnalysisRetryInput } from "./analysis-job-types"
import { checkAnalysisReadiness } from "./analysis-readiness"

export async function acceptAnalysisJob({
  session,
  input,
  logger,
  startedAtMs = Date.now(),
  expectedFailedId,
}: {
  session: AppSession
  input: AnalysisRetryInput
  logger: AppLogger
  startedAtMs?: number
  expectedFailedId?: string
}) {
  if (
    !session.coordinationId ||
    !session.clientId ||
    !session.pseudonym ||
    !session.consentId
  )
    return { ok: false as const, reason: "session_invalid" }
  if (
    session.lastCompletedAnalysisId ||
    (expectedFailedId
      ? session.activeAnalysisId !== expectedFailedId
      : session.activeAnalysisId !== undefined)
  )
    return { ok: false as const, reason: "analysis_mismatch" }
  const readiness = await checkAnalysisReadiness(session, logger)
  if (readiness.ok !== true) return readiness
  if (sessionOperation.getStore()?.signal?.aborted === true)
    return { ok: false as const, reason: "superseded_operation" }
  const suffix = generateRandomIdSuffix(ID_CONSTRAINTS.suffixLength)
  if (!suffix) return { ok: false as const, reason: "start_failed" }
  const analysisId = ID_CONSTRAINTS.analysisIdPrefix + suffix
  const reservation = reserveAnalysisJob({
    analysisId,
    startedAtMs,
    owner: {
      sessionId: session.coordinationId,
      clientId: session.clientId,
      pseudonym: session.pseudonym,
      consentId: session.consentId,
    },
  })
  if (!reservation)
    return { ok: false as const, reason: "capacity_unavailable" }
  let attempt: AnalysisAttempt | null = null
  try {
    session.activeAnalysisId = analysisId
    await session.save({ startAnalysisId: analysisId })
    attempt = await beginAnalysisAttempt({
      analysisId,
      session,
      documentGraphemeCounts: input.documentGraphemeCounts,
      logger,
    })
    if (!attempt) {
      // Response loss cannot establish whether Support accepted the start.
      // Keep the attempt protected, without starting inference or fabricating failure.
      setAnalysisOperation(session.coordinationId, analysisId, "unconfirmed")
      reservation.release()
      return { ok: false as const, reason: "start_unconfirmed" }
    }
    if (sessionOperation.getStore()?.signal?.aborted === true) {
      await reservation.terminate(attempt, logger)
      return { ok: false as const, reason: "superseded_operation" }
    }
    session.questionnaireKind = attempt.questionnaireKind
    session.stage =
      attempt.questionnaireKind === "follow-up"
        ? Stage.followUp
        : Stage.authenticated
    await session.save()
    if (sessionOperation.getStore()?.signal?.aborted === true) {
      await reservation.terminate(attempt, logger)
      return { ok: false as const, reason: "superseded_operation" }
    }
    reservation.start({ ...input, attempt, logger })
    logger.info({
      event: LOG_EVENT.llmAnalysisStarted,
      analysisId,
      outcome: "started",
    })
    return {
      ok: true as const,
      analysisId,
      status: "running" as const,
      startedAtMs,
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
      questionnaireKind: attempt.questionnaireKind,
    }
  } catch (error) {
    // Preserve the confirmed start and its retryable terminal through local
    // admission failures; do not orphan it by releasing the reservation first.
    if (attempt !== null) await reservation.terminate(attempt, logger)
    else reservation.release()
    logger.error({
      error,
      analysisId,
      event: LOG_EVENT.llmAnalysisFailed,
      operation: "analysis_start",
    })
    return { ok: false as const, reason: "start_unconfirmed" }
  }
}
