import {
  matchesDataPurpose,
  resolveDataPurposeFilter,
} from "@aerpp/firestore/data-purpose-types"
import {
  buildConsentUpdates,
  buildParticipantSummary,
  getConfiguredServerId,
  loadParticipationEventRecords,
} from "@/features/monitoring/participant-records"

import { loadRecoveryAuthorizations } from "./load-recovery-authorizations"

export async function loadParticipantPageData(purpose?: unknown) {
  const dataPurpose = resolveDataPurposeFilter(purpose)
  const normalizedServerId = getConfiguredServerId()
  const allRecords = await loadParticipationEventRecords("all", "all")
  const records = allRecords.filter(
    (record) =>
      (normalizedServerId === "all" ||
        record.serverId === normalizedServerId) &&
      matchesDataPurpose(record.dataPurpose, dataPurpose),
  )

  return {
    filters: {
      dataPurpose,
      serverId: normalizedServerId,
    },
    recoveryAuthorizations: await loadRecoveryAuthorizations(dataPurpose),
    recentActivity: buildConsentUpdates(records),
    summary: buildParticipantSummary(records, allRecords),
    records: records.slice(0, 200),
  }
}
