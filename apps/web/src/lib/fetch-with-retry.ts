import "server-only"

import { setTimeout as wait } from "node:timers/promises"
import type { AppLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { retryAfterMs } from "./http-retry"
import { sessionOperation } from "./session-authority"

// Mirrors the HTTP statuses that are worth retrying for external dependencies.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

// The per-attempt deadline also covers body reads after returning the response.
// Body-read failures belong to the caller and cannot replay a submitted request.
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  {
    timeoutMs,
    retries = 0,
    retryDelayMs = 2_000,
    totalTimeoutMs = timeoutMs * (retries + 1) + retryDelayMs * retries + 1000,
    logging,
  }: {
    logging?: {
      dependency: string
      logger: AppLogger
      target?: string
    }
    timeoutMs: number
    retries?: number
    retryDelayMs?: number
    totalTimeoutMs?: number
  },
): Promise<Response> {
  let attempt = 0
  const operationSignal = sessionOperation.getStore()?.signal
  const callerSignals = [init.signal, operationSignal].filter(
    (signal): signal is AbortSignal => signal != null,
  )
  const callerSignal = AbortSignal.any(callerSignals)
  const deadline = performance.now() + totalTimeoutMs
  const budgetSignal = AbortSignal.timeout(totalTimeoutMs)
  const operationDeadline = AbortSignal.any([callerSignal, budgetSignal])

  async function pause(milliseconds: number) {
    // A retry gets a full attempt budget; do not start a truncated request.
    if (deadline - performance.now() < milliseconds + timeoutMs) return false
    await wait(milliseconds, undefined, { signal: operationDeadline })
    // Event-loop delays must not turn the next attempt into a truncated wait.
    return deadline - performance.now() >= timeoutMs
  }

  while (true) {
    operationDeadline.throwIfAborted()
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = AbortSignal.any([operationDeadline, timeoutSignal])
    const startedAtMs = Date.now()
    let response: Response
    try {
      response = await fetch(input, {
        cache: "no-store",
        ...init,
        signal,
      })
    } catch (error) {
      callerSignal.throwIfAborted()
      const durationMs = Date.now() - startedAtMs
      if (
        attempt === retries ||
        deadline - performance.now() < retryDelayMs + timeoutMs
      ) {
        if (logging) {
          logging.logger.warn({
            attempt: attempt + 1,
            dependency: logging.dependency,
            durationMs,
            error,
            event: LOG_EVENT.dependencyRequestFailed,
            outcome: init.method === "POST" ? "unconfirmed" : "unavailable",
            retryCount: retries,
            target: logging.target,
            timeoutMs,
          })
        }
        throw error
      }
      if (logging) {
        logging.logger.debug({
          attempt: attempt + 1,
          dependency: logging.dependency,
          durationMs,
          event: LOG_EVENT.dependencyRequestRetried,
          outcome: "retrying",
          retryCount: retries,
          retryDelayMs,
          target: logging.target,
          timeoutMs,
        })
      }
      if ((await pause(retryDelayMs)) !== true) throw error
      attempt += 1
      continue
    }
    const durationMs = Date.now() - startedAtMs
    if (
      response.ok !== true &&
      isRetryableStatus(response.status) === true &&
      attempt < retries
    ) {
      const delay = Math.max(
        retryDelayMs,
        retryAfterMs(response.headers.get("Retry-After")),
      )
      if ((await pause(delay)) === true) {
        // Preserve the body until a full retry fits. Cleanup failure must not
        // become a transport retry with a shorter delay than Retry-After.
        void response.body?.cancel().catch(() => {})
        if (logging) {
          logging.logger.debug({
            attempt: attempt + 1,
            dependency: logging.dependency,
            durationMs,
            event: LOG_EVENT.dependencyRequestRetried,
            outcome: "retrying",
            retryCount: retries,
            retryDelayMs: delay,
            statusCode: response.status,
            target: logging.target,
            timeoutMs,
          })
        }
        attempt += 1
        continue
      }
    }
    if (logging && response.ok !== true) {
      logging.logger.warn({
        attempt: attempt + 1,
        dependency: logging.dependency,
        durationMs,
        event: LOG_EVENT.dependencyRequestFailed,
        outcome:
          init.method === "POST" && response.status >= 500
            ? "unconfirmed"
            : "failed",
        retryCount: retries,
        statusCode: response.status,
        target: logging.target,
        timeoutMs,
      })
    }
    return response
  }
}
