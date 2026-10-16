import "server-only"

import { withSessionOperation } from "@/features/session/session-operation"
import { createRequestLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { REQUEST_ID_HEADER } from "@/lib/request-id"
import {
  readAnalysisJobAccess,
  readAnalysisJobResultForTab,
  readAnalysisJobStatusForTab,
} from "./analysis-job-access"
import { acknowledgeMemoryAnalysisResult } from "./analysis-job-registry"
import { analysisIdSchema } from "./analysis-receipt-types"

export async function handleAnalysisJobRead(
  request: Request,
  resultOnly = false,
) {
  const { logger, requestId } = createRequestLogger(request, {
    component: "llm",
    operation: resultOnly ? "analysis_result" : "analysis_status",
  })
  const headers = {
    "Cache-Control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  }
  try {
    if (resultOnly === true) {
      const id = analysisIdSchema.safeParse(
        new URL(request.url).searchParams.get("analysisId"),
      )
      if (id.success !== true)
        return Response.json(
          { ok: false, reason: "invalid_request" },
          { status: 400, headers },
        )
      const result = await readAnalysisJobResultForTab(
        request.headers.get("x-aerpp-tab"),
        id.data,
      )
      return result
        ? Response.json(result, { headers })
        : Response.json(
            { ok: false, reason: "result_unavailable" },
            { status: 409, headers },
          )
    }
    return Response.json(
      await readAnalysisJobStatusForTab(request.headers.get("x-aerpp-tab")),
      { headers },
    )
  } catch (error) {
    const reason =
      error instanceof Error &&
      [
        "stale_session_state",
        "session_invalid",
        "session_snapshot_unavailable",
        "browser_context_invalid",
        "analysis_mismatch",
      ].includes(error.message)
        ? error.message
        : "status_unavailable"
    logger.warn({
      error,
      event: LOG_EVENT.routeRequestRejected,
      operation: "analysis_read",
      outcome: "rejected",
    })
    return Response.json(
      { ok: false, reason },
      { status: reason === "status_unavailable" ? 503 : 409, headers },
    )
  }
}

// Acknowledgement releases only RAM content and does not advance business state.
export async function handleAnalysisResultAcknowledgement(request: Request) {
  const { logger, requestId } = createRequestLogger(request, {
    component: "llm",
    operation: "analysis_acknowledgement",
  })
  const headers = {
    "Cache-Control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  }
  const id = analysisIdSchema.safeParse(
    new URL(request.url).searchParams.get("analysisId"),
  )
  if (id.success !== true)
    return Response.json(
      { ok: false, reason: "invalid_request" },
      { status: 400, headers },
    )
  const token = request.headers.get("x-aerpp-tab")
  const result = await withSessionOperation(token, "survey", async () => {
    const { session, owner } = await readAnalysisJobAccess(token)
    if (
      session.lastCompletedAnalysisId !== id.data ||
      session.presentedAnalysisId !== id.data
    )
      return { ok: false as const, reason: "analysis_mismatch" }
    return acknowledgeMemoryAnalysisResult(id.data, owner) === true
      ? { ok: true as const }
      : { ok: false as const, reason: "acknowledgement_failed" }
  })
  if (result.ok !== true)
    logger.warn({
      event: LOG_EVENT.routeRequestRejected,
      operation: "analysis_acknowledgement",
      outcome: "rejected",
    })
  return Response.json(result, {
    status: result.ok === true ? 200 : 409,
    headers,
  })
}
