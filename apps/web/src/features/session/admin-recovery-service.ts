import "server-only"

import { beginAdminRecovery } from "@/features/app-context/step-state-transition-service"
import { readPendingAdminRecovery } from "@/features/auth/auth-service"
import {
  getSession,
  getSessionForTab,
  getSessionToken,
  isSessionSnapshotCurrent,
} from "@/lib/session"
import { readAuthority } from "@/lib/session-authority"
import type { AdminRecoveryRequest } from "./admin-recovery-types"
import { withAdminRecoveryOperation } from "./session-operation"

export async function handleAdminRecovery(
  token: string,
  request: AdminRecoveryRequest,
) {
  // Recovery still requires the current cookie and hash, but never depends on
  // decrypting the old private context that the participant is discarding.
  const authorityToken = token.split(":").slice(0, 2).join(":")
  if (request.intent === "check") {
    const session = await getSessionForTab(authorityToken)
    const recovery = await readPendingAdminRecovery(session)
    const id = session.coordinationId
    const current = id ? readAuthority(id) : null
    if (!current || isSessionSnapshotCurrent(session, current) !== true)
      return { ok: false, reason: "stale_session_state" }
    return recovery
      ? { ok: true, recovery, sessionToken: getSessionToken(current.id) }
      : { ok: false, reason: "recovery_not_authorized" }
  }
  return withAdminRecoveryOperation(authorityToken, async () => {
    const session = await getSession()
    const id = session.coordinationId
    if (!id) return { ok: false, reason: "session_not_admitted" }
    const recovery = await readPendingAdminRecovery(session)
    if (!recovery || recovery.recoveryId !== request.recoveryId)
      return { ok: false, reason: "recovery_changed" }
    if (request.intent === "ready") {
      if (session.adminRecoveryId !== recovery.recoveryId || session.consentId)
        return { ok: false, reason: "recovery_in_progress" }
      if (session.adminRecoveryCleanupPending === true) {
        delete session.adminRecoveryCleanupPending
        await session.save()
      }
      return { ok: true, recovery }
    }
    const result = await beginAdminRecovery(recovery.recoveryId)
    if (result.ok !== true) return result
    return {
      ok: true,
      recovery,
      cleanupRevision: readAuthority(id)?.revision,
    }
  })
}
