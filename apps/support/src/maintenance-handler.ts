import {
  type Runtime,
  supportMaintenanceWindowActive,
} from "@aerpp/config/support"
import type { RequestHandler } from "express"
import type { TokenPayload } from "google-auth-library"
import { assertSchedulerClaims } from "./access.js"
import { throwApiError } from "./api-errors.js"
import { logger } from "./logger.js"
import type { Mailer } from "./mail.js"
import type { OidcVerifier } from "./maintenance-types.js"
import { sweepWithdrawalCleanup } from "./withdrawal-cleanup.js"

export function createMaintenanceHandler(
  path: string,
  operation: string,
  runtime: Runtime,
  mailer: Mailer,
  verifier: OidcVerifier,
): RequestHandler {
  return async (req, res) => {
    res.locals.operation = operation
    const token = /^Bearer ([^\s]+)$/.exec(req.get("authorization") ?? "")?.[1]
    if (token === undefined) throwApiError(401, "UNAUTHORIZED", "unauthorized")
    const audience = new URL(path, runtime.baseUrl).href
    let payload: TokenPayload | undefined
    try {
      payload = await verifier(token, audience)
    } catch {
      throwApiError(401, "UNAUTHORIZED", "unauthorized")
    }
    assertSchedulerClaims(payload, audience, runtime.schedulerIdentity)
    if (runtime.maintenanceEnabled !== true)
      throwApiError(503, "MAINTENANCE_DISABLED", "maintenance disabled")
    if (supportMaintenanceWindowActive(runtime) !== true) {
      logger.info(
        { operation, code: "MAINTENANCE_OUTSIDE_WINDOW" },
        "Maintenance skipped outside the backend operating window",
      )
      res.json({
        ok: true,
        skipped: true,
        code: "MAINTENANCE_OUTSIDE_WINDOW",
      })
      return
    }
    if (operation === "withdrawalCleanup") {
      const counts = await sweepWithdrawalCleanup()
      if (counts.failed > 0)
        logger.error(
          { operation, code: "WITHDRAWAL_CLEANUP_FAILED", ...counts },
          "Withdrawal cleanup needs attention",
        )
      else
        logger.info(
          { operation, code: "MAINTENANCE_COMPLETED", ...counts },
          "Withdrawal cleanup completed",
        )
      if (counts.failed > 0) {
        res.status(503).json({
          ok: false,
          code: "WITHDRAWAL_CLEANUP_FAILED",
          error: "Withdrawal cleanup incomplete; retry required",
          ...counts,
        })
      } else res.json({ ok: true, ...counts })
    } else {
      await mailer.health()
      logger.info(
        { operation, code: "MAINTENANCE_COMPLETED" },
        "Mail health check completed",
      )
      res.json({ ok: true })
    }
  }
}
