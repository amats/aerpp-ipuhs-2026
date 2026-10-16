"use server"

import { timingSafeEqual } from "node:crypto"
import { env } from "@aerpp/config/server/admin"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import {
  deriveParticipantDocumentId,
  deriveParticipantPseudonym,
  formatParticipantDocumentDate,
} from "@aerpp/participant-api-contracts/identifiers"
import { requireAdminSession } from "@/lib/auth"
import { firestore } from "@/lib/firestore"
import { dateMillis } from "@/lib/record-time"
import { verifyDocumentArchive } from "./document-archive"
import {
  type DocumentVerificationState,
  documentVerificationInputSchema,
} from "./document-verification-types"

export async function verifyParticipantDocumentAction(
  _previous: DocumentVerificationState,
  formData: FormData,
): Promise<DocumentVerificationState> {
  await requireAdminSession("/participant")
  const parsed = documentVerificationInputSchema.safeParse({
    email: formData.get("email"),
    date: formData.get("date"),
    purpose: formData.get("purpose"),
    did: formData.get("did"),
    version: formData.get("version"),
    sha256: formData.get("sha256"),
    requestId: formData.get("requestId"),
  })
  if (parsed.success !== true)
    return {
      message: "メールアドレス・日付・文書種別・DIDを確認してください。",
    }
  const input = parsed.data
  const date = formatParticipantDocumentDate(
    new Date(`${input.date}T00:00:00.000Z`),
  )
  const expected = deriveParticipantDocumentId(
    input.email,
    date,
    input.purpose,
    env.identifierHashSecret,
    input.sha256,
  )
  const matched = timingSafeEqual(Buffer.from(expected), Buffer.from(input.did))
  const pseudonym = deriveParticipantPseudonym(
    input.email,
    env.identifierHashSecret,
  )
  let archiveVerified = false
  let receiptMatched: boolean | undefined
  if (matched === true) {
    try {
      await verifyDocumentArchive({
        version: input.version,
        sha256: input.sha256,
      })
      archiveVerified = true
    } catch {
      /* Missing originals do not turn a mathematical match into a mismatch. */
    }
    try {
      const records = await createParticipantRepository(firestore)
        .participationEventsFor(pseudonym)
        .get()
      receiptMatched = records.docs.some((doc) => {
        const record = doc.data()
        const timestamp = dateMillis(
          record[
            input.purpose === "consent"
              ? "consentConfirmedAt"
              : "withdrawalAcceptedAt"
          ],
        )
        return (
          record.eventType === input.purpose &&
          (env.participantApiServerId === "all" ||
            record.serverId === env.participantApiServerId) &&
          record.documentSet?.sha256 === input.sha256 &&
          record.documentSet?.version === input.version &&
          timestamp !== null &&
          formatParticipantDocumentDate(new Date(timestamp)) === date
        )
      })
    } catch {
      /* Report unavailable receipt lookup separately. */
    }
  }
  return {
    requestId: input.requestId,
    matched,
    pseudonym,
    archiveVerified,
    receiptMatched,
    message:
      matched === true
        ? "DIDが一致しました。原本と受付記録の確認結果も参照してください。"
        : "DIDが一致しません。入力内容と対象環境を確認してください。",
  }
}
