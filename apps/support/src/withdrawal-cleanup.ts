import { ApiError } from "./api-errors.js"
import {
  deleteWithdrawnParticipantData,
  getParticipationStateRef,
  WITHDRAWAL_CLEANUP_BUDGET_MS,
} from "./participant-state.js"
import {
  FieldValue,
  getFirestore,
  getParticipantRepository,
} from "./storage.js"

// Pending participation state is the durable work list; committing withdrawal
// never depends on a second queue write or on a surviving browser session.
export async function sweepWithdrawalCleanup() {
  const deadline = Date.now() + WITHDRAWAL_CLEANUP_BUDGET_MS
  const counts = {
    scanned: 0,
    completed: 0,
    pending: 0,
    superseded: 0,
    failed: 0,
  }
  const db = getFirestore()
  const checkpoint = db.collection("maintenance").doc("withdrawalCleanup")
  const cursor = (await checkpoint.get()).data()?.cursor
  if (Date.now() >= deadline) return counts
  const query = getParticipantRepository()
    .participationStates()
    .where("cleanupStatus", "==", "pending")
    .orderBy("__name__")
    .limit(8)
  let candidates = await (typeof cursor === "string" &&
  cursor &&
  !cursor.includes("/")
    ? query.startAfter(cursor)
    : query
  ).get()
  if (candidates.empty && cursor && Date.now() < deadline)
    candidates = await query.get()
  for (const candidate of candidates.docs) {
    if (Date.now() >= deadline) break
    // Advance before work so persistent errors or process death cannot starve
    // later records. Wrapping the cursor revisits unfinished work next round.
    await checkpoint.set({
      cursor: candidate.id,
      updatedAt: FieldValue.serverTimestamp(),
    })
    counts.scanned++
    const data = candidate.data()
    const withdrawalId = data.lastWithdrawalId
    if (
      typeof data.pseudonym !== "string" ||
      !data.pseudonym ||
      getParticipationStateRef(data.pseudonym).id !== candidate.id ||
      typeof withdrawalId !== "string" ||
      !withdrawalId ||
      withdrawalId.includes("/")
    ) {
      counts.failed++
      continue
    }
    try {
      await deleteWithdrawnParticipantData(
        data.pseudonym,
        withdrawalId,
        deadline,
      )
      counts.completed++
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "WITHDRAWAL_CLEANUP_PENDING"
      )
        counts.pending++
      else if (error instanceof ApiError && error.code === "CONSENT_SUPERSEDED")
        counts.superseded++
      else counts.failed++
    }
  }
  return counts
}
