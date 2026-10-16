"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { subscribeBrowserState } from "@/lib/browser-database"
import {
  commitBrowserAdmission,
  getBrowserSession,
  isBrowserSessionCurrent,
} from "@/lib/browser-session"
import {
  activateTabOperations,
  isTabOperationCurrent,
  subscribeTabCancellation,
} from "@/lib/tab-cancellation"
import { setTabToken } from "@/lib/tab-token"
import { admitSessionAction } from "./actions-session"

export function useSessionAdmission(onCancelled?: () => void) {
  const [status, setStatus] = useState<"checking" | "unavailable" | "ready">(
    "checking",
  )
  const [initialStep, setInitialStep] = useState<Awaited<
    ReturnType<typeof admitSessionAction>
  > | null>(null)
  const [canRetryAdmission, setCanRetryAdmission] = useState(false)
  const [admissionAttempt, setAdmissionAttempt] = useState(0)
  const latestAttempt = useRef(admissionAttempt)
  latestAttempt.current = admissionAttempt
  const invalidated = useRef(false)
  const cancelledCallback = useRef(onCancelled)
  cancelledCallback.current = onCancelled
  useEffect(
    () =>
      subscribeBrowserState(() => {
        isTabOperationCurrent()
      }),
    [],
  )
  useEffect(
    () =>
      subscribeTabCancellation(() => {
        invalidated.current = true
        setCanRetryAdmission(false)
        setStatus("unavailable")
        cancelledCallback.current?.()
      }),
    [],
  )
  useEffect(() => {
    let cancelled = false
    invalidated.current = false
    setStatus("checking")
    setCanRetryAdmission(false)
    function isObsolete() {
      return (
        cancelled ||
        admissionAttempt !== latestAttempt.current ||
        invalidated.current === true
      )
    }
    async function admit() {
      if (cancelled || admissionAttempt !== latestAttempt.current) return
      const scope = await getBrowserSession()
      if (isObsolete() === true) return
      if (isBrowserSessionCurrent(scope) !== true) {
        invalidated.current = true
        setStatus("unavailable")
        return
      }
      const result = await admitSessionAction(scope)
      if (isObsolete() === true) return
      if (isBrowserSessionCurrent(scope) !== true) {
        invalidated.current = true
        setStatus("unavailable")
        return
      }
      if (result.ok === true) {
        await commitBrowserAdmission(scope, result.scope, result.recovered)
        if (isObsolete() === true) return
        if (result.recovered === true) {
          localStorage.clear()
          sessionStorage.clear()
        }
        setTabToken(result.sessionToken)
        activateTabOperations(result.sessionToken)
        if (
          result.recoveryRequired === true &&
          window.location.pathname !== "/recovery"
        )
          window.location.replace("/recovery")
      }
      setInitialStep(result)
      setCanRetryAdmission(result.ok !== true)
      setStatus(result.ok === true ? "ready" : "unavailable")
    }
    const locks = window.navigator.locks
    // Only bootstrap is serialized to share the first issued browser cookie.
    const pending = locks
      ? locks.request("aerpp-session-admission", admit)
      : admit()
    void pending.catch(() => {
      if (
        !cancelled &&
        admissionAttempt === latestAttempt.current &&
        invalidated.current !== true
      ) {
        setCanRetryAdmission(true)
        setStatus("unavailable")
      }
    })
    return () => {
      cancelled = true
    }
  }, [admissionAttempt])
  const retryAdmission = useCallback(() => {
    if (canRetryAdmission === true)
      setAdmissionAttempt((attempt) => attempt + 1)
  }, [canRetryAdmission])
  return { status, initialStep, canRetryAdmission, retryAdmission }
}
