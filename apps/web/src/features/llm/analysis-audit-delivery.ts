import "server-only"

import { env } from "@aerpp/config/server/web"
import { analysisAuditStore } from "@/lib/analysis-audit-store"
import { createLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { safeParseApiSuccess } from "@/lib/participant-api-contract-helpers"
import { participantAuditHeaders } from "@/lib/participant-api-headers"

const logger = createLogger({ component: "analysis-audit-delivery" })
let draining = false
let timer: ReturnType<typeof setInterval> | undefined
let lastHealthReportAt = 0
let lastHealthLevel = ""

export async function drainAnalysisAudit() {
  if (draining === true) return
  draining = true
  try {
    const store = analysisAuditStore()
    const health = store.health()
    const level =
      health.blockedCount > 0 || health.oldestAgeMs >= 60 * 60_000
        ? "error"
        : health.oldestAgeMs >= 15 * 60_000
          ? "warn"
          : ""
    if (
      level !== "" &&
      (level !== lastHealthLevel ||
        Date.now() - lastHealthReportAt >= 5 * 60_000)
    ) {
      logger[level]({ event: LOG_EVENT.analysisAuditQueueStalled, ...health })
      lastHealthReportAt = Date.now()
    }
    lastHealthLevel = level
    for (let index = 0; index < 4; index += 1) {
      const lease = store.claim()
      if (!lease) break
      let code: number | null = null
      let success = false
      let retryAfter: string | null = null
      try {
        const response = await fetch(env.recordAnalysisOutcomeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...participantAuditHeaders(),
          },
          body: JSON.stringify(lease.body),
          signal: AbortSignal.timeout(15_000),
        })
        code = response.status
        retryAfter = response.headers.get("Retry-After")
        const parsed = safeParseApiSuccess(
          "recordAnalysisOutcome",
          await response.json().catch(() => null),
        )
        success = code === 200 && parsed.success === true
      } catch {
        // Retry from the durable lease without logging transport content.
      }
      store.settle(lease, success, code, Date.now(), retryAfter)
      // Report transitions and sparse repeated failures; successful polling is silent.
      if (
        success !== true &&
        (lease.attempts === 1 || (lease.attempts & (lease.attempts - 1)) === 0)
      )
        logger.error({
          event: LOG_EVENT.analysisAuditDeliveryFailed,
          statusCode: code ?? undefined,
          attempt: lease.attempts,
        })
    }
  } catch (error) {
    logger.error({ event: LOG_EVENT.analysisAuditQueueFailed, error })
  } finally {
    draining = false
  }
}

export function startAnalysisAuditDelivery() {
  if (timer) return
  timer = setInterval(() => {
    void drainAnalysisAudit()
  }, 15_000)
  timer.unref()
  void drainAnalysisAudit()
}
