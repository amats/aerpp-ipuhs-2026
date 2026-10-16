import type { ParticipationEventRecord } from "@/features/auth/participation-event-types"
import type {
  DocumentHistory,
  DocumentHistoryPeriod,
  DocumentHistoryRecord,
} from "./document-history-types"

function summarizeRecord(
  record: ParticipationEventRecord,
): DocumentHistoryRecord {
  return {
    id: record.id,
    eventType: record.eventType,
    date: record.eventAt.toISOString(),
    documentSet: record.documentSet,
  }
}

export function buildDocumentHistory(
  records: ParticipationEventRecord[],
  currentConsentId: string,
): DocumentHistory {
  const periods = new Map<string, DocumentHistoryPeriod>()
  for (const record of records) {
    if (record.eventType !== "consent") continue
    const consentId = record.consentId ?? record.id
    if (periods.has(consentId) === true)
      throw new Error("Ambiguous document consent history")
    periods.set(consentId, {
      consent: summarizeRecord(record),
      withdrawal: null,
    })
  }
  for (const record of records) {
    if (record.eventType !== "withdrawal") continue
    const period = record.consentId ? periods.get(record.consentId) : undefined
    // Never associate receipts by date or silently omit an unlinked event.
    if (!period || period.withdrawal !== null)
      throw new Error("Unmatched document withdrawal history")
    period.withdrawal = summarizeRecord(record)
  }
  const current = periods.get(currentConsentId)
  if (!current) throw new Error("Document consent evidence required")
  const previous = [...periods.values()]
    .filter((period) => period !== current)
    .sort((a, b) => {
      const aDate = a.withdrawal?.date ?? a.consent.date
      const bDate = b.withdrawal?.date ?? b.consent.date
      return (
        bDate.localeCompare(aDate) || a.consent.id.localeCompare(b.consent.id)
      )
    })
  return { current, previous }
}
