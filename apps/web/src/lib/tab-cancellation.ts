"use client"

import {
  commitSessionBrowserContext,
  isBrowserSessionCurrent,
  readBrowserRecoveryRevision,
} from "./browser-session"
import { isRejectedSessionState } from "./session-failure"
import { readTabGeneration } from "./session-generation"
import { getTabToken, setTabToken } from "./tab-token"

let controller: AbortController | undefined
let sessionScope: string | undefined
let recoveryRevision = 0
const listeners = new Set<() => void>()

export function cancelTabOperations() {
  if (controller?.signal.aborted) return
  controller ??= new AbortController()
  controller.abort()
  for (const listener of listeners) listener()
}

export function subscribeTabCancellation(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function activateTabOperations(token: string) {
  recoveryRevision = readBrowserRecoveryRevision()
  sessionScope = readTabGeneration(token) ?? undefined
  controller?.abort()
  controller = new AbortController()
}

export function isTabOperationCurrent() {
  if (controller?.signal.aborted) return false
  if (
    sessionScope !== undefined &&
    (isBrowserSessionCurrent(sessionScope) !== true ||
      readBrowserRecoveryRevision() !== recoveryRevision)
  ) {
    cancelTabOperations()
    return false
  }
  return true
}

export async function adoptSessionToken(value: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return
  if (value === null || typeof value !== "object") return
  const token = "sessionToken" in value ? value.sessionToken : undefined
  if (
    typeof token === "string" &&
    readTabGeneration(token) === readTabGeneration(getTabToken())
  ) {
    if ("browserContext" in value) {
      const context = value.browserContext
      const scope = readTabGeneration(token) as string
      const revision =
        "browserContextRevision" in value
          ? value.browserContextRevision
          : undefined
      if (typeof revision !== "number" || !Number.isSafeInteger(revision))
        throw new Error("Invalid browser context revision")
      if (typeof context !== "string" && context !== null)
        throw new Error("Invalid browser context")
      const committed = await commitSessionBrowserContext(
        scope,
        revision,
        context,
      )
      if (signal?.aborted || isTabOperationCurrent() !== true) return
      if (committed !== true) {
        cancelTabOperations()
        return
      }
    }
    setTabToken(token)
  }
}

export function getTabOperationSignal() {
  isTabOperationCurrent()
  return controller?.signal
}

// Both action results and wrapped responses use the same cancellation/adoption
// boundary, including the asynchronous browser-context commit.
async function waitForCurrentTabOperation<T>(
  operation: Promise<T>,
  operationSignal?: AbortSignal,
) {
  const tabSignal = getTabOperationSignal()
  const signal = operationSignal
    ? AbortSignal.any([operationSignal, ...(tabSignal ? [tabSignal] : [])])
    : tabSignal
  const cancelled = {
    ok: false as const,
    reason: "superseded_operation" as const,
  }
  let onAbort = () => {}
  try {
    // Also consume late rejections when cancellation wins the race.
    const pending = Promise.race([
      operation.then((value) => ({ ok: true as const, value })),
      new Promise<typeof cancelled>((resolve) => {
        onAbort = () => resolve(cancelled)
        signal?.addEventListener("abort", onAbort, { once: true })
        if (signal?.aborted) onAbort()
      }),
    ])
    const result = await pending
    if (
      result.ok !== true ||
      signal?.aborted ||
      isTabOperationCurrent() !== true
    )
      return cancelled
    const response = result.value
    if (
      response !== null &&
      typeof response === "object" &&
      "reason" in response &&
      response.reason === "recovery_required"
    ) {
      cancelTabOperations()
      window.location.assign("/recovery")
      return cancelled
    }
    const rejectedState =
      response !== null &&
      typeof response === "object" &&
      "reason" in response &&
      isRejectedSessionState(response.reason) === true
    if (rejectedState) cancelTabOperations()
    else await adoptSessionToken(response, signal)
    if (!rejectedState && (signal?.aborted || isTabOperationCurrent() !== true))
      return cancelled
    return result
  } catch (error) {
    if (signal?.aborted || !isTabOperationCurrent()) return cancelled
    throw error
  } finally {
    signal?.removeEventListener("abort", onAbort)
  }
}

export async function waitForTabOperation<T>(operation: Promise<T>) {
  const result = await waitForCurrentTabOperation(operation)
  return result.ok === true ? result.value : result
}

export async function awaitTabResponse<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const result = await waitForCurrentTabOperation(operation, signal)
  if (result.ok !== true)
    throw new DOMException("Operation superseded", "AbortError")
  return result.value
}
