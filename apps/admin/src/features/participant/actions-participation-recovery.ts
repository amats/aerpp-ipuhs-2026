"use server"

import { createHash, randomUUID } from "node:crypto"
import { env } from "@aerpp/config/server/admin"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import { FieldValue } from "@google-cloud/firestore"
import { revalidatePath } from "next/cache"
import { requireAdminSession } from "@/lib/auth"
import { firestore } from "@/lib/firestore"
import { logParticipationRecoveryFailure } from "@/lib/logger"
import { reviewRecovery } from "./participation-recovery-service"
import {
  type RecoveryActionState,
  type RecoveryReview,
  recoveryInputSchema,
  recoveryReviewSchema,
} from "./participation-recovery-types"

export async function authorizeParticipationRecoveryAction(
  _previous: RecoveryActionState,
  formData: FormData,
): Promise<RecoveryActionState> {
  const session = await requireAdminSession("/participant")
  const parsed = recoveryInputSchema.safeParse({
    pseudonym: formData.get("pseudonym"),
    destination: formData.get("destination"),
    analysisId: formData.get("analysisId") || undefined,
    reason: formData.get("reason"),
  })
  if (parsed.success !== true || !session.user?.email)
    return { message: "PID、復旧先、対象解析ID、理由を確認してください。" }
  const input = parsed.data
  const confirmed = formData.get("confirm") === "yes"
  const recoveryId = confirmed
    ? String(formData.get("recoveryId"))
    : randomUUID()
  if (!/^[a-f0-9-]{36}$/.test(recoveryId))
    return { message: "再度対象を確認してください。" }
  const previousReview = recoveryReviewSchema.safeParse(_previous?.review)
  // Previous UI state can preserve retry identity, but never grants authority.
  const retryReview =
    confirmed === true &&
    previousReview.success === true &&
    previousReview.data.recoveryId === recoveryId &&
    previousReview.data.fingerprint === formData.get("fingerprint") &&
    previousReview.data.pseudonym === input.pseudonym &&
    previousReview.data.destination === input.destination &&
    previousReview.data.reason === input.reason &&
    previousReview.data.analysisId === input.analysisId
      ? previousReview.data
      : undefined
  const repository = createParticipantRepository(firestore)
  const actorId = createHash("sha256")
    .update(session.user.email.toLowerCase())
    .digest("hex")
  try {
    const result = await firestore.runTransaction(async (tx) => {
      const receipt = confirmed
        ? await tx.get(repository.participationEvent(recoveryId))
        : undefined
      if (receipt?.exists) {
        const data = receipt.data()
        if (
          data?.actorId !== actorId ||
          data.pseudonym !== input.pseudonym ||
          data.destination !== input.destination ||
          data.reason !== input.reason ||
          (data.analysisId ?? null) !== (input.analysisId ?? null)
        )
          throw new Error("RECOVERY_STALE")
        return {
          newlyAuthorized: false,
          message:
            "この復旧許可は既に記録されています。履歴を確認してください。",
        }
      }
      const review = await reviewRecovery(tx, input)
      if (confirmed !== true)
        return {
          newlyAuthorized: false,
          message:
            "対象と復旧先を確認してください。結果を参照したかは参加者への確認が必要です。",
          review: {
            ...input,
            analysisId: review.analysisId,
            fingerprint: review.fingerprint,
            recoveryId,
            status: review.state.status,
            questionnaireKind:
              review.state.studyStatus === "follow-up"
                ? "follow-up"
                : "initial",
            completedAt: review.completedAt,
            presentedAt: review.presentedAt,
          } satisfies RecoveryReview,
        }
      if (formData.get("fingerprint") !== review.fingerprint)
        throw new Error("RECOVERY_STALE")
      const old = review.state.recoveryAuthorization
      const oldRef =
        old && !old.usedConsentId
          ? repository.participationEvent(old.recoveryId)
          : undefined
      if (oldRef) await tx.get(oldRef)
      const authorization = {
        recoveryId,
        destination: input.destination,
        questionnaireKind:
          input.destination === "follow-up-document" ? "follow-up" : "initial",
        ...(review.analysisId
          ? { analysisId: review.analysisId, sourceOwner: review.sourceOwner }
          : {}),
        expectedStudyGeneration: review.state.studyGeneration ?? null,
        precedingWithdrawalId: review.state.lastWithdrawalId ?? null,
        actorId,
        reason: input.reason,
        authorizedAt: FieldValue.serverTimestamp(),
      }
      tx.update(review.stateRef, { recoveryAuthorization: authorization })
      if (oldRef)
        tx.set(
          oldRef,
          {
            supersededBy: recoveryId,
            supersededAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      tx.create(repository.participationEvent(recoveryId), {
        ...authorization,
        pseudonym: input.pseudonym,
        serverId: env.participantApiServerId,
        eventType: "recovery_authorized",
        dataPurpose: review.state.dataPurpose ?? "unclassified",
      })
      return {
        newlyAuthorized: true,
        message:
          "復旧を許可しました。参加者はフッターの「研究責任者に復旧を依頼した方へ」を開き、「研究責任者の復旧許可を適用」から同意・メール確認をやり直してください。",
      }
    })
    // A refresh failure must not reclassify a committed authorization.
    if (confirmed === true) {
      try {
        revalidatePath("/participant")
      } catch (error) {
        logParticipationRecoveryFailure(error)
      }
    }
    const { newlyAuthorized: _newlyAuthorized, ...state } = result
    return state
  } catch (error) {
    logParticipationRecoveryFailure(error)
    const needsReview =
      error instanceof Error &&
      [
        "RECOVERY_STALE",
        "RECOVERY_STATE_UNAVAILABLE",
        "RECOVERY_TARGET_UNAVAILABLE",
      ].includes(error.message)
    if (retryReview && needsReview !== true)
      return {
        review: retryReview,
        message:
          "復旧許可の結果を確認できませんでした。同じ確認内容を保持しています。時間をおいて再度「確認して復旧を許可する」を押してください。受理済みの場合は重複して許可しません。",
      }
    return {
      message:
        "対象が利用できないか、確認後に記録が更新されました。未回答の初回解析、参加状態、撤回後の削除を確認し、再度対象を確認してください。",
    }
  }
}
