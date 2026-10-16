"use server"

import { env } from "@aerpp/config/server/web"
import {
  withSessionOperation,
  withSessionRead,
} from "@/features/session/session-operation"
import { fetchWithRetry } from "@/lib/fetch-with-retry"
import {
  isApiSuccess,
  safeParseApiRequest,
} from "@/lib/participant-api-contract-helpers"
import { participantApiHeaders } from "@/lib/participant-api-headers"
import { getSession } from "@/lib/session"

export async function recordResultPresentationAction(
  analysisId: string,
  token?: string,
) {
  const observed = await withSessionRead(token, async () => {
    const session = await getSession()
    if (session.lastCompletedAnalysisId !== analysisId)
      return { ok: false as const, reason: "analysis_mismatch" }
    return session.presentedAnalysisId === analysisId
      ? { ok: true as const }
      : { ok: false as const, reason: "presentation_required" }
  })
  if (observed.ok === true || observed.reason !== "presentation_required")
    return observed
  return withSessionOperation(token, "survey", async () => {
    const session = await getSession()
    if (session.lastCompletedAnalysisId !== analysisId)
      return { ok: false as const, reason: "analysis_mismatch" }
    if (session.presentedAnalysisId === analysisId) return { ok: true as const }
    const request = safeParseApiRequest("recordAnalysisAttempt", {
      outcome: "presented",
      analysisId,
      consentId: session.consentId,
      clientId: session.clientId,
      pseudonym: session.pseudonym,
      serverId: env.participantApiServerId,
    })
    if (!request.success)
      return { ok: false as const, reason: "presentation_failed" }
    const response = await fetchWithRetry(
      env.recordAnalysisAttemptUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...participantApiHeaders(),
        },
        body: JSON.stringify(request.data),
      },
      {
        timeoutMs: 15_000,
        totalTimeoutMs: 31_000,
        retries: 1,
        retryDelayMs: 250,
      },
    )
    if ((await isApiSuccess("recordAnalysisAttempt", response)) !== true)
      return { ok: false as const, reason: "presentation_failed" }
    session.presentedAnalysisId = analysisId
    await session.save()
    return { ok: true as const }
  })
}
