import "server-only"

import { Stage } from "@/features/app-context/stage-types"
import { readStageFromSession } from "@/features/app-context/step-state-session"
import {
  hasPendingAdminRecovery,
  requiresAdminRecovery,
} from "@/features/auth/auth-service"
import { matchesSessionEmail } from "@/features/auth/auth-session"
import { readEmailFromSession } from "@/features/auth/email"
import { readWithdrawalRequestFromSession } from "@/features/withdraw/withdrawal-session"
import { createLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { isReceptionClosed } from "@/lib/reception"
import {
  type AppSession,
  getSessionForTab,
  getSessionToken,
  isSessionSnapshotCurrent,
} from "@/lib/session"
import {
  createOperationId,
  readAuthority,
  sessionOperation,
  updateAuthority,
  watchAuthority,
} from "@/lib/session-authority"
import { isRejectedSessionState } from "@/lib/session-failure"

type SessionOperation = "ordinary" | "survey" | "analysis_cleanup"

// Reads keep the selected snapshot and never compete for a mutation fence.
export async function withSessionRead<T>(
  token: unknown,
  operation: () => Promise<T>,
  options?: { allowAcceptedWithdrawal: boolean },
): Promise<T | { ok: false; reason: string }> {
  try {
    const session = await getSessionForTab(token)
    const id = session.coordinationId
    if (!id) return { ok: false, reason: "session_not_admitted" }
    const current = readAuthority(id)
    if (!current || isSessionSnapshotCurrent(session, current) !== true)
      return { ok: false, reason: "stale_session_state" }
    // Accepted withdrawal permanently fences ordinary work. Receipt reads may
    // continue after that mutation ends, without reopening analysis or writes.
    const allowsWithdrawalRead =
      options?.allowAcceptedWithdrawal === true &&
      readStageFromSession(session) === Stage.withdrawn &&
      readWithdrawalRequestFromSession(session) !== null
    if (
      current.withdrawing !== 0 &&
      (allowsWithdrawalRead !== true || current.busy !== null)
    )
      return { ok: false, reason: "session_busy" }
    const result = await sessionOperation.run(
      {
        id,
        operationId: "read-only",
        readOnly: true,
        browserContext:
          typeof token === "string" ? token.split(":")[2] : undefined,
      },
      operation,
    )
    const latest = readAuthority(id)
    if (
      !latest ||
      isSessionSnapshotCurrent(session, latest) !== true ||
      (latest.withdrawing !== 0 &&
        (allowsWithdrawalRead !== true || latest.busy !== null))
    )
      return { ok: false, reason: "stale_session_state" }
    return result !== null &&
      typeof result === "object" &&
      !(result instanceof Response)
      ? Object.assign(result, { sessionToken: getSessionToken(id) })
      : result
  } catch (error) {
    createLogger({ component: "session", operation: "read" }).error({
      event: LOG_EVENT.sessionGetFailed,
      error,
    })
    return {
      ok: false,
      reason:
        error instanceof Error && isRejectedSessionState(error.message) === true
          ? error.message
          : "session_read_failed",
    }
  }
}

// Serialize conflicting business operations, never the lifetime of a tab.
// Admission and read-only analysis observation remain available in every tab.
export async function withSessionOperation<T>(
  token: unknown,
  kind: SessionOperation,
  operation: () => Promise<T>,
): Promise<T | { ok: false; reason: string }> {
  return runSessionOperation(token, kind, operation)
}

export async function withAdminRecoveryOperation<T>(
  token: unknown,
  operation: () => Promise<T>,
) {
  return runSessionOperation(
    token,
    "admin_recovery",
    operation,
    async (session) =>
      (await hasPendingAdminRecovery(session)) === true
        ? null
        : "recovery_not_authorized",
  )
}

export async function withWithdrawalOperation<T>(
  token: unknown,
  email: string,
  operation: () => Promise<T>,
  validate?: (session: AppSession) => string | null,
): Promise<T | { ok: false; reason: string }> {
  return runSessionOperation(token, "withdraw", operation, async (session) => {
    const stage = readStageFromSession(session)
    if (
      stage !== Stage.authenticated &&
      stage !== Stage.followUp &&
      stage !== Stage.withdrawn
    )
      return "stage_mismatch"
    if (
      matchesSessionEmail(await readEmailFromSession(session), email) !== true
    )
      return "email_mismatch"
    // Reject preparation prerequisites before cancelling ordinary work or
    // retaining a withdrawal fence. Dispatched retries keep that fence.
    return validate?.(session) ?? null
  })
}

export async function withWithdrawalCleanupOperation<T>(
  token: unknown,
  operation: () => Promise<T>,
): Promise<T | { ok: false; reason: string }> {
  return runSessionOperation(
    token,
    "withdraw_cleanup",
    operation,
    async (session) => {
      const stage = readStageFromSession(session)
      if (stage === Stage.withdrawn) return null
      // Resume the saved intent if persistence failed after upstream withdrawal.
      return (stage === Stage.authenticated || stage === Stage.followUp) &&
        readWithdrawalRequestFromSession(session)
        ? null
        : "stage_mismatch"
    },
  )
}

async function runSessionOperation<T>(
  token: unknown,
  kind: SessionOperation | "withdraw" | "withdraw_cleanup" | "admin_recovery",
  operation: () => Promise<T>,
  validate?: (session: AppSession) => Promise<string | null>,
): Promise<T | { ok: false; reason: string }> {
  try {
    const session = await getSessionForTab(token)
    if (validate) {
      const reason = await validate(session)
      if (reason) return { ok: false, reason }
    }
    if (
      (kind === "ordinary" || kind === "survey") &&
      (await requiresAdminRecovery(session)) === true
    )
      return { ok: false, reason: "recovery_required" }
    if (
      (kind === "ordinary" || kind === "analysis_cleanup") &&
      session.pendingSurveyAnalysisId &&
      session.pendingSurveyAnalysisId !== session.submittedAnalysisId
    )
      return { ok: false, reason: "submission_pending" }
    const id = session.coordinationId
    if (!id) return { ok: false, reason: "session_not_admitted" }
    const operationId = createOperationId()
    const context = {
      id,
      operationId,
      browserContext:
        typeof token === "string" ? token.split(":")[2] : undefined,
      browserContextChanged: false,
      signal: undefined as AbortSignal | undefined,
    }
    const acquired = updateAuthority(id, (current) => {
      if (kind === "admin_recovery") {
        if (isSessionSnapshotCurrent(session, current) !== true) return null
        return { ...current, busy: operationId, withdrawing: 0 }
      }
      if (kind === "withdraw" || kind === "withdraw_cleanup") {
        if (kind === "withdraw_cleanup" && current.busy) return null
        // The checked identity must still belong to this exact snapshot.
        if (isSessionSnapshotCurrent(session, current) !== true) return null
        return {
          ...current,
          busy: operationId,
          withdrawing: 1,
        }
      }
      if (typeof token !== "string" || current.withdrawing || current.busy)
        return null
      if (isSessionSnapshotCurrent(session, current) !== true) return null
      return { ...current, busy: operationId }
    })
    if (acquired !== true) return { ok: false, reason: "session_busy" }
    const cancellation = watchAuthority(
      id,
      (current) => current.busy === operationId && !isReceptionClosed(),
    )
    const cancelled = { ok: false as const, reason: "superseded_operation" }
    context.signal = cancellation.signal
    let onAbort = () => {}
    try {
      const aborted = new Promise<typeof cancelled>((resolve) => {
        onAbort = () => resolve(cancelled)
        cancellation.signal.addEventListener("abort", onAbort, { once: true })
      })
      if (cancellation.signal.aborted) return cancelled
      const result = await Promise.race([
        sessionOperation.run(context, operation),
        aborted,
      ])
      if (cancellation.signal.aborted) return cancelled
      // A grant can be installed after preflight and reject the upstream write.
      if (
        (kind === "ordinary" || kind === "survey") &&
        ((result instanceof Response && result.ok !== true) ||
          (result !== null &&
            typeof result === "object" &&
            "ok" in result &&
            result.ok === false))
      ) {
        const recoveryRequired = await Promise.race([
          // A failed optional recheck must still deliver the original result
          // and its saved browser retry context to the participant.
          sessionOperation
            .run(context, () => requiresAdminRecovery(session))
            .catch(() => false),
          aborted,
        ])
        if (cancellation.signal.aborted) return cancelled
        if (recoveryRequired === true)
          return { ok: false, reason: "recovery_required" }
      }
      return result !== null &&
        typeof result === "object" &&
        !(result instanceof Response)
        ? Object.assign(result, {
            sessionToken: getSessionToken(id),
            ...(context.browserContextChanged
              ? {
                  browserContext: context.browserContext ?? null,
                  browserContextRevision: readAuthority(id)?.revision,
                }
              : {}),
          })
        : result
    } finally {
      cancellation.signal.removeEventListener("abort", onAbort)
      cancellation.dispose()
      updateAuthority(id, (current) =>
        current.busy === operationId ? { ...current, busy: null } : null,
      )
    }
  } catch (error) {
    createLogger({ component: "session", operation: kind }).error({
      event: LOG_EVENT.sessionWriteFailed,
      error,
    })
    return {
      ok: false,
      reason:
        error instanceof Error && error.message === "session_admission_pending"
          ? "session_busy"
          : error instanceof Error &&
              [
                "stale_session_state",
                "session_invalid",
                "session_snapshot_unavailable",
                "browser_context_invalid",
              ].includes(error.message)
            ? error.message
            : "session_operation_failed",
    }
  }
}
