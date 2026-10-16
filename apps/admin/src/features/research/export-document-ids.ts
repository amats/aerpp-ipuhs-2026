import {
  deriveParticipantDocumentId,
  formatParticipantDocumentDate,
} from "@aerpp/participant-api-contracts/identifiers"
import { DocumentSetReferenceSchema } from "@aerpp/participant-api-contracts/participant-api"
import { dateMillis } from "../../lib/record-time"
import { EMAIL_DECRYPTION_FAILURE } from "./export-email"
import type { SourceDocument } from "./research-types"

export function addConsentDocumentIds(
  records: SourceDocument[],
  identifierHashSecret: string,
): SourceDocument[] {
  if (identifierHashSecret.trim() === "")
    throw new Error("Identifier hash secret required for document IDs")
  return records.map(({ id, data }) => {
    let did: string | null = null
    const purpose = data.eventType
    const timestamp = dateMillis(
      data[
        purpose === "consent" ? "consentConfirmedAt" : "withdrawalAcceptedAt"
      ],
    )
    const reference = DocumentSetReferenceSchema.safeParse(data.documentSet)
    const linked =
      purpose !== "withdrawal" ||
      records.some(
        (record) =>
          record.data.eventType === "consent" &&
          record.data.pseudonym === data.pseudonym &&
          (record.data.consentId ?? record.id) === data.consentId,
      )
    if (
      linked === true &&
      (purpose === "consent" || purpose === "withdrawal") &&
      timestamp !== null &&
      reference.success === true &&
      typeof data.email === "string" &&
      data.email.trim() !== "" &&
      data.email !== EMAIL_DECRYPTION_FAILURE
    )
      did = deriveParticipantDocumentId(
        data.email,
        formatParticipantDocumentDate(new Date(timestamp)),
        purpose,
        identifierHashSecret,
        reference.data.sha256,
      )
    return { id, data: { ...data, did } }
  })
}
