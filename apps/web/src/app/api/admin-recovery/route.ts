import { handleAdminRecovery } from "@/features/session/admin-recovery-service"
import { adminRecoveryRequestSchema } from "@/features/session/admin-recovery-types"
import { createRequestLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { REQUEST_ID_HEADER } from "@/lib/request-id"
import { readTabGeneration } from "@/lib/session-generation"

export async function POST(request: Request) {
  const { logger, requestId } = createRequestLogger(request, {
    component: "session",
    operation: "admin_recovery",
  })
  const headers = {
    "Cache-Control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  }
  const token = request.headers.get("x-aerpp-tab")
  if (
    !token ||
    !readTabGeneration(token) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json(
      { ok: false, reason: "session_invalid" },
      { status: 400, headers },
    )
  const body = adminRecoveryRequestSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (body.success !== true)
    return Response.json(
      { ok: false, reason: "invalid_request" },
      { status: 400, headers },
    )
  try {
    const result = await handleAdminRecovery(token, body.data)
    return Response.json(result, {
      status: result.ok === true ? 200 : 409,
      headers,
    })
  } catch (error) {
    logger.error({ error, event: LOG_EVENT.sessionWriteFailed })
    return Response.json(
      { ok: false, reason: "recovery_unavailable" },
      { status: 503, headers },
    )
  }
}
