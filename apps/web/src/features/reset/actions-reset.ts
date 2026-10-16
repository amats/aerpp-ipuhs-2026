"use server"

import { env } from "@aerpp/config/server/web"
import { createLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { resetSession } from "./reset-session-service"

const logger = createLogger({ component: "reset", operation: "clear_cookies" })

export type SessionResetResult =
  | { ok: true }
  | { ok: false; reason: "cookie_clear_failed" }

// Delete only cookies captured by this request; immutable newer names survive a delayed response.
export async function resetSessionAction(
  scope: string,
  replacementScope?: string,
): Promise<SessionResetResult> {
  try {
    if (env.debugPagesEnabled !== true)
      return { ok: false, reason: "cookie_clear_failed" }
    await resetSession(scope, replacementScope)
    return { ok: true }
  } catch (error) {
    logger.error({ error, event: LOG_EVENT.cookieClearFailed })
    return { ok: false, reason: "cookie_clear_failed" }
  }
}
