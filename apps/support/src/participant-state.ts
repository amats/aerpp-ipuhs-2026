import { normalizeDataPurpose } from "@aerpp/firestore/data-purpose-types"
import { throwApiError } from "./api-errors.js"

import {
  FieldValue,
  getFirestore,
  getParticipantRepository,
  type Transaction,
} from "./storage.js"
import { assertMatchingSurveyOwner } from "./survey-payload.js"
import { retainWithdrawalActivity } from "./withdrawal-activity.js"

export const getParticipationStateRef = (pseudonym: string) =>
  getParticipantRepository().participationState(pseudonym)

export const WITHDRAWAL_CLEANUP_BUDGET_MS = 40_000

function cleanupPending(): never {
  return throwApiError(
    503,
    "WITHDRAWAL_CLEANUP_PENDING",
    "withdrawal recorded; retry to finish deletion",
  )
}

function assertCleanupTimeRemaining(deadline: number) {
  if (Date.now() >= deadline) cleanupPending()
}

// All callers finish their reads before writing. Retained history without state
// must fail closed instead of silently admitting a previously withdrawn participant.
export async function readParticipationState(
  tx: Transaction,
  pseudonym: string,
) {
  const ref = getParticipationStateRef(pseudonym)
  const snapshot = await tx.get(ref)
  const data = snapshot.data()
  if (snapshot.exists) {
    if (
      !data ||
      data.pseudonym !== pseudonym ||
      !["active", "withdrawn"].includes(data.status)
    )
      throwApiError(
        409,
        "PARTICIPATION_STATE_INVALID",
        "invalid participation state",
      )
    if (data.status === "withdrawn" && !data.lastWithdrawalId)
      throwApiError(
        409,
        "PARTICIPATION_STATE_INVALID",
        "withdrawal history missing",
      )
    return { ref, data }
  }
  const history = await tx.get(
    getParticipantRepository().participationEventsFor(pseudonym).limit(1),
  )
  if (!history.empty)
    throwApiError(
      409,
      "PARTICIPATION_STATE_INVALID",
      "participation state missing",
    )
  return {
    ref,
    data: { pseudonym, status: "active", lastWithdrawalId: undefined },
  }
}

export function assertActiveParticipation(
  state: Awaited<ReturnType<typeof readParticipationState>>,
) {
  if (state.data.status === "withdrawn")
    throwApiError(403, "PARTICIPATION_WITHDRAWN", "participation withdrawn")
}

export async function assertCurrentConsent(
  tx: Transaction,
  state: Awaited<ReturnType<typeof readParticipationState>>,
  owner: {
    consentId: string
    pseudonym: string
    clientId: string
    serverId: string
  },
  allowPendingRecovery = false,
) {
  const snapshot = await tx.get(
    getParticipantRepository().participationEvent(owner.consentId),
  )
  const consent = snapshot.data()
  if (
    allowPendingRecovery !== true &&
    state.data.recoveryAuthorization &&
    !state.data.recoveryAuthorization.usedConsentId
  )
    throwApiError(
      409,
      "CONSENT_SUPERSEDED",
      "researcher recovery requires fresh authentication",
    )
  if (consent?.authenticationVersion !== 2)
    throwApiError(401, "AUTHENTICATION_INVALID", "confirmed consent required")
  if (
    consent?.eventType !== "consent" ||
    (consent.studyGeneration ?? null) !==
      (state.data.studyGeneration ?? null) ||
    (consent.precedingWithdrawalId ?? null) !==
      (state.data.consentBoundaryId ?? null)
  )
    throwApiError(409, "CONSENT_SUPERSEDED", "consent is no longer current")
  assertMatchingSurveyOwner(consent, owner)
  return {
    dataPurpose: normalizeDataPurpose(consent.dataPurpose),
    precedingWithdrawalId: consent.precedingWithdrawalId ?? null,
  }
}
// Bound deletes, retained run projections and progress writes.
// Committed deletion counts and progress survive a lost response or a later failure.
export async function deleteWithdrawnParticipantData(
  pseudonym: string,
  expectedWithdrawalId: string,
  deadline = Date.now() + WITHDRAWAL_CLEANUP_BUDGET_MS,
) {
  let batchSize = 100
  for (let page = 0; page < 20 && Date.now() < deadline; page++) {
    let attemptedBatchSize = batchSize
    try {
      const result = await getFirestore().runTransaction(async (tx) => {
        // Firestore may retry the callback after contention/backoff.
        assertCleanupTimeRemaining(deadline)
        const state = await readParticipationState(tx, pseudonym)
        assertCleanupTimeRemaining(deadline)
        if (
          state.data.status !== "withdrawn" ||
          state.data.lastWithdrawalId !== expectedWithdrawalId
        )
          return throwApiError(
            409,
            "CONSENT_SUPERSEDED",
            "withdrawal is no longer current",
          )
        const jobRef =
          getParticipantRepository().withdrawalJob(expectedWithdrawalId)
        const job = (await tx.get(jobRef)).data()
        if (
          job &&
          (job.pseudonym !== pseudonym ||
            job.consentBoundaryId !== (state.data.consentBoundaryId ?? null))
        )
          throwApiError(409, "CONSENT_SUPERSEDED", "withdrawal job conflicts")
        if (
          job &&
          (job.status !== state.data.cleanupStatus ||
            job.deletedCount !== (state.data.deletedCount ?? 0))
        )
          throwApiError(
            409,
            "WITHDRAWAL_JOB_CONFLICT",
            "withdrawal progress does not match state",
          )
        if (state.data.cleanupStatus === "complete")
          return {
            complete: true,
            completedNow: false,
            deletedCount: job?.deletedCount ?? state.data.deletedCount ?? 0,
          }
        const storedSize = state.data.cleanupBatchSize
        const limit =
          Number.isInteger(storedSize) && storedSize >= 1 && storedSize <= 100
            ? Math.min(batchSize, storedSize)
            : batchSize
        attemptedBatchSize = limit
        const analysisQuestionnaires = await tx.get(
          getParticipantRepository()
            .analysisQuestionnairesFor(pseudonym)
            .limit(limit),
        )
        assertCleanupTimeRemaining(deadline)
        const attempts = analysisQuestionnaires.empty
          ? await tx.get(
              getParticipantRepository()
                .analysisAttemptsFor(pseudonym)
                .limit(limit),
            )
          : undefined
        assertCleanupTimeRemaining(deadline)
        const auth =
          analysisQuestionnaires.empty && attempts?.empty
            ? await tx.get(
                getFirestore()
                  .collection("emailConfirmations")
                  .where("pseudonym", "==", pseudonym)
                  .limit(limit),
              )
            : undefined
        assertCleanupTimeRemaining(deadline)
        const docs = auth
          ? auth.docs
          : attempts
            ? attempts.docs
            : analysisQuestionnaires.docs
        const retainedRuns = !auth
          ? await Promise.all(
              docs.map((doc) =>
                tx.get(getParticipantRepository().analysisRun(doc.id)),
              ),
            )
          : []
        assertCleanupTimeRemaining(deadline)
        const deletedCount =
          (job?.deletedCount ?? state.data.deletedCount ?? 0) +
          analysisQuestionnaires.size
        for (const [index, doc] of docs.entries()) {
          if (!auth)
            retainWithdrawalActivity(
              tx,
              doc.id,
              doc.data(),
              expectedWithdrawalId,
              attempts ? "attempt" : "questionnaire",
              retainedRuns[index]?.data(),
            )
          if (auth) {
            const data = doc.data()
            tx.set(
              getParticipantRepository().participationEvent(
                `authentication-${doc.id}`,
              ),
              {
                ...Object.fromEntries(
                  [
                    "pseudonym",
                    "consentId",
                    "clientId",
                    "serverId",
                    "dataPurpose",
                    "encryptedEmail",
                    "documentSet",
                    "precedingWithdrawalId",
                    "studyGeneration",
                    "recoveryId",
                    "status",
                    "createdAt",
                    "updatedAt",
                    "expireAt",
                  ]
                    .filter((key) => Object.hasOwn(data, key))
                    .map((key) => [key, data[key]]),
                ),
                eventType: "authentication_retired",
                retiredAt: FieldValue.serverTimestamp(),
                withdrawalId: expectedWithdrawalId,
              },
            )
          }
          tx.delete(doc.ref)
        }
        tx.set(
          jobRef,
          {
            schemaVersion: 1,
            pseudonym,
            withdrawalId: expectedWithdrawalId,
            consentBoundaryId: state.data.consentBoundaryId ?? null,
            status: docs.length === 0 ? "complete" : "pending",
            deletedCount,
            updatedAt: FieldValue.serverTimestamp(),
            ...(docs.length === 0
              ? { completedAt: FieldValue.serverTimestamp() }
              : {}),
          },
          { merge: true },
        )
        tx.set(
          state.ref,
          {
            deletedCount,
            cleanupBatchSize: limit,
            cleanupStatus: docs.length === 0 ? "complete" : "pending",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        return {
          complete: docs.length === 0,
          completedNow: docs.length === 0,
          deletedCount,
        }
      })
      if (result.complete === true) {
        return result.deletedCount
      }
    } catch (error) {
      // Firestore enforces byte/index-entry limits as well as write counts.
      // Shrink only resource/argument failures; all other errors retain the fence
      // and surface for retry. A single undeletable document needs operator review.
      const code = (error as { code?: number | string })?.code
      if (
        [3, 8, "invalid-argument", "resource-exhausted"].includes(code ?? "") &&
        attemptedBatchSize > 1
      ) {
        batchSize = Math.max(1, Math.floor(attemptedBatchSize / 2))
        continue
      }
      throw error
    }
  }
  return cleanupPending()
}
