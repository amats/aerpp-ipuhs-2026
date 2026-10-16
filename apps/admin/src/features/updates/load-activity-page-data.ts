import { resolveDataPurposeFilter } from "@aerpp/firestore/data-purpose-types"
import {
  buildRecentActivity,
  getConfiguredServerId,
  loadParticipationEventRecords,
  loadSurveyRecords,
} from "@/features/monitoring/participant-records"

export async function loadActivityPageData(purpose?: unknown) {
  const dataPurpose = resolveDataPurposeFilter(purpose)
  const normalizedServerId = getConfiguredServerId()
  const [allParticipationEventRecords, allSurveyRecords] = await Promise.all([
    loadParticipationEventRecords("all", dataPurpose),
    loadSurveyRecords("all", dataPurpose, [], { includeAnswers: false }),
  ])
  const consentRecords =
    normalizedServerId === "all"
      ? allParticipationEventRecords
      : allParticipationEventRecords.filter(
          (record) => record.serverId === normalizedServerId,
        )
  const surveyRecords =
    normalizedServerId === "all"
      ? allSurveyRecords
      : allSurveyRecords.filter(
          (record) => record.serverId === normalizedServerId,
        )

  return {
    filters: {
      dataPurpose,
      serverId: normalizedServerId,
    },
    recentActivity: buildRecentActivity(consentRecords, surveyRecords),
  }
}
