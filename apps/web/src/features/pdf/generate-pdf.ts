import "server-only"

import { formatParticipantDocumentDate } from "@aerpp/participant-api-contracts/identifiers"
import { listParticipationEvents } from "@/features/auth/auth-service"
import { decryptEmail } from "@/features/auth/email"
import type { ParticipationEventRecord } from "@/features/auth/participation-event-types"
import { fillParticipantPdf } from "@/features/pdf/fill-participant-pdf"
import {
  createParticipantDocumentId,
  createPseudonym,
} from "../identity/participant-identifiers"
import { readPdfFont, readRecordedPdfTemplate } from "./pdf-templates"

type GeneratedPdf = {
  documentId: string
  pdfBytes: Uint8Array
}

async function generateParticipantPdf(
  email: string,
  consentId: string,
  eventType: "consent" | "withdrawal",
  recordId?: string,
): Promise<GeneratedPdf> {
  const pseudonym = createPseudonym(email)
  const records = await listParticipationEvents(pseudonym)
  const sessionConsent = records.find(
    (record) =>
      record.eventType === "consent" &&
      (record.consentId ?? record.id) === consentId,
  )
  if (!sessionConsent) throw new Error("no session consent record found")

  // Bind the copy to this session's participation period, even if another
  // browser has since withdrawn or confirmed consent for a new period.
  const periodConsents = records.filter(
    (record) =>
      record.eventType === "consent" &&
      (record.precedingWithdrawalId ?? null) ===
        (sessionConsent.precedingWithdrawalId ?? null),
  )
  const periodConsentIds = new Set(
    periodConsents.map((record) => record.consentId ?? record.id),
  )
  const matchingRecords = records
    .filter(
      (record) =>
        record.eventType === eventType &&
        (recordId !== undefined
          ? record.id === recordId
          : eventType === "consent"
            ? record.id === sessionConsent.id
            : periodConsentIds.has(record.consentId ?? "")),
    )
    .sort(
      (a, b) =>
        a.eventAt.getTime() - b.eventAt.getTime() || a.id.localeCompare(b.id),
    )
  if (matchingRecords.length === 0) {
    throw new Error(`no ${eventType} record found`)
  }

  const record = matchingRecords[0]
  if (record.pseudonym !== pseudonym)
    throw new Error("Document owner conflicts")
  return generateRecordedParticipantPdf(record)
}

export async function generateRecordedParticipantPdf(
  record: ParticipationEventRecord,
): Promise<GeneratedPdf> {
  const email = await decryptEmail(record.encryptedEmail)
  if (!email || createPseudonym(email) !== record.pseudonym)
    throw new Error("Document email unavailable")
  const dateText = formatParticipantDocumentDate(record.eventAt)
  const documentId = createParticipantDocumentId(
    email,
    dateText,
    record.eventType,
    record.documentSet.sha256,
  )
  if (!documentId) throw new Error("failed to generate document ID")
  const [templateBytes, fontBytes] = await Promise.all([
    readRecordedPdfTemplate(record.eventType, record),
    readPdfFont(),
  ])
  return {
    documentId,
    pdfBytes: await fillParticipantPdf(templateBytes, fontBytes, {
      email,
      date: dateText,
      documentId,
      documentSet: record.documentSet,
    }),
  }
}

export async function generateConsentPdf(
  email: string,
  consentId: string,
  recordId?: string,
): Promise<GeneratedPdf> {
  return generateParticipantPdf(email, consentId, "consent", recordId)
}

export async function generateWithdrawalPdf(
  email: string,
  consentId: string,
  recordId?: string,
): Promise<GeneratedPdf> {
  return generateParticipantPdf(email, consentId, "withdrawal", recordId)
}
