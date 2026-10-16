import "server-only"

import { env } from "@aerpp/config/server/web"
import { analysisAuditStore } from "@/lib/analysis-audit-store"
import { fetchWithRetry } from "@/lib/fetch-with-retry"
import type { AppLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import {
  type ApiRequest,
  isApiSuccess,
  safeParseApiRequest,
  safeParseApiSuccess,
} from "@/lib/participant-api-contract-helpers"
import { participantApiHeaders } from "@/lib/participant-api-headers"
import type { AppSession } from "@/lib/session"
import { sessionOperation, setAnalysisOperation } from "@/lib/session-authority"

type AnalysisOutcome = "completed" | "failed" | "cancelled"

export async function beginAnalysisAttempt({
  analysisId,
  session,
  documentGraphemeCounts,
  logger,
}: {
  analysisId: string
  session: AppSession
  documentGraphemeCounts: number[]
  logger: AppLogger
}) {
  const startedAtMs = Date.now()
  const start = safeParseApiRequest("recordAnalysisAttempt", {
    analysisId,
    consentId: session.consentId,
    clientId: session.clientId,
    pseudonym: session.pseudonym,
    serverId: env.participantApiServerId,
    outcome: "started",
    startedAtMs,
    documentGraphemeCounts,
  })
  if (!start.success) return null

  async function record(body: ApiRequest<"recordAnalysisAttempt">) {
    try {
      const response = await fetchWithRetry(
        env.recordAnalysisAttemptUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...participantApiHeaders(),
          },
          body: JSON.stringify(body),
        },
        {
          timeoutMs: 15_000,
          totalTimeoutMs: 31_000,
          retries: 1,
          retryDelayMs: 250,
          logging: {
            logger,
            dependency: "record_analysis_attempt",
            target: "participant_api",
          },
        },
      )
      const parsed = safeParseApiSuccess(
        "recordAnalysisAttempt",
        await response.json().catch(() => null),
      )
      if (response.status === 200 && parsed.success === true) return parsed.data
      logger.warn({
        event: LOG_EVENT.analysisAttemptRecordFailed,
        analysisId,
        statusCode: response.status,
        outcome:
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
            ? "rejected"
            : "unconfirmed",
      })
    } catch (error) {
      logger.warn({
        event: LOG_EVENT.analysisAttemptRecordFailed,
        analysisId,
        error,
        outcome: "unconfirmed",
      })
    }
    return null
  }

  const recordedStart = await record(start.data)
  if (recordedStart?.questionnaireKind === undefined) return null
  const questionnaireKind = recordedStart.questionnaireKind
  let completion: Promise<boolean> | undefined
  let terminal:
    | (ApiRequest<"recordAnalysisAttempt"> & { outcome: AnalysisOutcome })
    | undefined
  let remoteConfirmed = false
  async function recordTerminal(): Promise<boolean> {
    if (!terminal) return false
    const audit = {
      analysisId: terminal.analysisId,
      consentId: terminal.consentId,
      clientId: terminal.clientId,
      pseudonym: terminal.pseudonym,
      serverId: terminal.serverId,
      outcome: terminal.outcome,
      endedAtMs: terminal.endedAtMs,
    }
    try {
      // A confirmed remote write survives a later local failure. Retry only
      // unfinished phases; never reopen or replace the frozen terminal outcome.
      if (remoteConfirmed !== true) {
        analysisAuditStore().enqueue(audit, Date.now(), (connection) => {
          if (session.coordinationId)
            setAnalysisOperation(
              session.coordinationId,
              analysisId,
              audit.outcome === "completed" ? "completed" : "unconfirmed",
              connection,
            )
        })
        remoteConfirmed = (await record(terminal)) !== null
      }
      if (remoteConfirmed !== true) return false
      if (session.coordinationId)
        setAnalysisOperation(
          session.coordinationId,
          analysisId,
          terminal.outcome,
        )
    } catch (error) {
      logger.error({
        event: LOG_EVENT.analysisAttemptRecordFailed,
        analysisId,
        error,
      })
      return false
    }
    try {
      // Queue cleanup is repeatable maintenance, not a reason to undo success.
      analysisAuditStore().acknowledge(audit)
    } catch (error) {
      logger.error({ event: LOG_EVENT.analysisAuditQueueFailed, error })
    }
    return true
  }
  return {
    questionnaireKind,
    finish(outcome: AnalysisOutcome) {
      // A terminal event belongs to this historical attempt, even after owner
      // cancellation. It cannot mutate a session or a replacement attempt.
      if (!completion) {
        // Freeze identity and facts before any fallible storage or network work.
        const endedAtMs = Date.now()
        const body = start.data
        terminal = {
          analysisId,
          consentId: body.consentId,
          clientId: body.clientId,
          pseudonym: body.pseudonym,
          serverId: body.serverId,
          outcome,
          endedAtMs,
          durationMs: Math.max(0, endedAtMs - startedAtMs),
        }
        completion = sessionOperation.exit(() => recordTerminal())
      }
      return completion
    },
    async retryFinish() {
      const previous = completion
      if (!previous || !terminal) return false
      if ((await previous) === true) return true
      if (completion !== previous) return completion as Promise<boolean>
      completion = sessionOperation.exit(() => recordTerminal())
      return completion
    },
  }
}

export type AnalysisAttempt = NonNullable<
  Awaited<ReturnType<typeof beginAnalysisAttempt>>
>

export async function recordUnavailableAnalysis({
  analysisId,
  session,
  logger,
}: {
  analysisId: string
  session: AppSession
  logger: AppLogger
}) {
  const body = safeParseApiRequest("recordAnalysisAttempt", {
    analysisId,
    consentId: session.consentId,
    clientId: session.clientId,
    pseudonym: session.pseudonym,
    serverId: env.participantApiServerId,
    outcome: "unavailable",
    reason: "result_unavailable",
  })
  if (body.success !== true) return false
  try {
    const response = await fetchWithRetry(
      env.recordAnalysisAttemptUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...participantApiHeaders(),
        },
        body: JSON.stringify(body.data),
      },
      {
        timeoutMs: 15_000,
        totalTimeoutMs: 31_000,
        retries: 1,
        retryDelayMs: 250,
      },
    )
    return await isApiSuccess("recordAnalysisAttempt", response)
  } catch (error) {
    logger.error({
      event: LOG_EVENT.analysisAttemptRecordFailed,
      analysisId,
      error,
    })
    return false
  }
}
