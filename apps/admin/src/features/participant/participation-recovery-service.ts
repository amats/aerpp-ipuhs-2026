import "server-only"
import { createHash } from "node:crypto"
import { env } from "@aerpp/config/server/admin"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import { ConsentBoundOwnerSchema } from "@aerpp/participant-api-contracts/participant-api"
import type { Transaction } from "@google-cloud/firestore"
import { firestore } from "@/lib/firestore"
import { dateMillis } from "@/lib/record-time"
import type { RecoveryReview } from "./participation-recovery-types"

export async function reviewRecovery(
  tx: Transaction,
  input: Pick<
    RecoveryReview,
    "pseudonym" | "destination" | "analysisId" | "reason"
  >,
) {
  const repository = createParticipantRepository(firestore)
  const stateRef = repository.participationState(input.pseudonym)
  const stateSnapshot = await tx.get(stateRef)
  const state = stateSnapshot.data()
  if (
    !state ||
    state.pseudonym !== input.pseudonym ||
    !["active", "withdrawn"].includes(state.status) ||
    (state.status === "withdrawn" && state.cleanupStatus !== "complete")
  )
    throw new Error("RECOVERY_STATE_UNAVAILABLE")
  let sourceOwner: ReturnType<typeof ConsentBoundOwnerSchema.parse> | undefined
  let completedAt: number | null = null
  let presentedAt: number | null = null
  let targetVersion: string | null = null
  const analysisId =
    input.destination === "initial-survey"
      ? (input.analysisId ?? state.initialAnalysis?.analysisId)
      : undefined
  if (input.destination === "initial-survey") {
    if (!analysisId) throw new Error("RECOVERY_TARGET_UNAVAILABLE")
    const target = await tx.get(repository.analysisQuestionnaire(analysisId))
    const attempt = await tx.get(repository.analysisAttempt(analysisId))
    const data = target.data()
    const execution = attempt.data()
    sourceOwner = ConsentBoundOwnerSchema.parse(data)
    const executionOwner = ConsentBoundOwnerSchema.parse(execution)
    if (
      !data?._integrity?.metadata ||
      data.analysisId !== analysisId ||
      data.submittedAt ||
      sourceOwner.pseudonym !== input.pseudonym ||
      (env.participantApiServerId !== "all" &&
        sourceOwner.serverId !== env.participantApiServerId) ||
      JSON.stringify(executionOwner) !== JSON.stringify(sourceOwner) ||
      execution?.outcome !== "completed" ||
      execution.questionnaireKind !== "initial"
    )
      throw new Error("RECOVERY_TARGET_UNAVAILABLE")
    completedAt = dateMillis(execution.endedAtMs) ?? dateMillis(data.createdAt)
    presentedAt = dateMillis(data.presentationRecordedAt)
    targetVersion = `${target.updateTime?.seconds}:${target.updateTime?.nanoseconds}:${attempt.updateTime?.seconds}:${attempt.updateTime?.nanoseconds}`
  }
  // Update times protect against all intervening changes, including consumption
  // or a replacement grant. Confirmation is never authority on its own.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        analysisId,
        stateVersion: `${stateSnapshot.updateTime?.seconds}:${stateSnapshot.updateTime?.nanoseconds}`,
        targetVersion,
      }),
    )
    .digest("hex")
  return {
    stateRef,
    state,
    sourceOwner,
    analysisId,
    fingerprint,
    completedAt,
    presentedAt,
  }
}
