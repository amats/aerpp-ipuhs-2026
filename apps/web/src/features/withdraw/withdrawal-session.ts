import "server-only"

import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import { safeParseApiRequest } from "@/lib/participant-api-contract-helpers"
import type { AppSession } from "@/lib/session"

export function readWithdrawalRequestFromSession(session: AppSession) {
  const parsed = safeParseApiRequest(
    "withdrawParticipation",
    session.withdrawalRequest,
  )
  return parsed.success ? parsed.data : null
}

export function validateWithdrawalDocumentSet(
  session: AppSession,
  displayedSha256: string,
) {
  // Saved requests retain their original set across deployments and retries.
  if (readWithdrawalRequestFromSession(session) !== null) return null
  return displayedSha256 === readDisplayedDocumentSet().sha256
    ? null
    : "document_set_changed"
}

export function validatePreparedWithdrawalRequest(session: AppSession) {
  return readWithdrawalRequestFromSession(session) === null
    ? "withdrawal_preparation_required"
    : null
}

export function readWithdrawalCleanupCompletedFromSession(
  session: AppSession,
): boolean {
  return session.withdrawalCleanupCompleted === true
}
