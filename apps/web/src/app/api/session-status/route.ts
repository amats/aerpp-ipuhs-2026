import { readSessionStatus } from "@/features/session/session-status-service"
import { createRequestLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { REQUEST_ID_HEADER } from "@/lib/request-id"
import { readTabGeneration } from "@/lib/session-generation"

export async function POST(request: Request) {
  const { logger, requestId } = createRequestLogger(request, {
    component: "session",
    operation: "session_status",
  })
  const headers = {
    "Cache-Control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  }
  const token = request.headers.get("x-aerpp-tab")
  // The custom header cannot be sent by a cross-origin form or simple request.
  if (
    !token ||
    !readTabGeneration(token) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json(null, { status: 400, headers })
  try {
    const status = await readSessionStatus(token)
    return Response.json(status, { status: status ? 200 : 409, headers })
  } catch (error) {
    logger.error({ error, event: LOG_EVENT.sessionGetFailed })
    return Response.json(null, { status: 503, headers })
  }
}
