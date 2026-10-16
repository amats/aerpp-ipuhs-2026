import "server-only"
import {
  matchesDataPurpose,
  resolveDataPurposeFilter,
} from "@aerpp/firestore/data-purpose-types"
import type { InformationRecord } from "@aerpp/firestore/information-types"

import { informationRepository } from "@/features/information/information-service"
import { buildOperationalSummary } from "@/features/log/operational-log-summary"
import type { OperationalGroup } from "@/features/log/operational-log-types"
import {
  type ActivityItem,
  buildAnalysisAttemptSummary,
  buildParticipantSummary,
  buildRecentActivity,
  buildSurveySummary,
  type DashboardFilters,
  getConfiguredServerId,
  loadAnalysisAttempts,
  loadParticipationEventRecords,
  loadSurveyRecords,
  type ParticipantSummary,
  type SurveySummary,
} from "@/features/monitoring/participant-records"
import { listOperationalLogs } from "@/lib/cloud-logging"
import type { OperationalLogs } from "@/lib/cloud-logging-types"
import { logInformationFailure } from "@/lib/logger"

export type DashboardData = {
  filters: DashboardFilters
  participantSummary: ParticipantSummary
  surveySummary: SurveySummary
  attemptCounts: ReturnType<typeof buildAnalysisAttemptSummary>
  information: InformationRecord[]
  informationError: string | null
  recentActivity: ActivityItem[]
  operationalLogs: OperationalLogs
  attention: OperationalGroup[]
}

export async function loadDashboardData(input: {
  dataPurpose?: unknown
}): Promise<DashboardData> {
  const dataPurpose = resolveDataPurposeFilter(input.dataPurpose)
  const serverId = getConfiguredServerId()
  const [
    allParticipationEventRecords,
    allSurveyRecords,
    attempts,
    logs,
    notices,
  ] = await Promise.all([
    loadParticipationEventRecords("all", "all"),
    loadSurveyRecords("all", dataPurpose, [], { includeAnswers: false }),
    loadAnalysisAttempts(serverId, dataPurpose),
    listOperationalLogs(1),
    loadDashboardInformation(),
  ])
  const consentRecords = allParticipationEventRecords.filter(
    (record) =>
      (serverId === "all" || record.serverId === serverId) &&
      matchesDataPurpose(record.dataPurpose, dataPurpose),
  )
  const surveyRecords =
    serverId === "all"
      ? allSurveyRecords
      : allSurveyRecords.filter((record) => record.serverId === serverId)

  return {
    filters: {
      dataPurpose,
      serverId,
    },
    information: notices.information,
    informationError: notices.informationError,
    participantSummary: buildParticipantSummary(
      consentRecords,
      allParticipationEventRecords,
    ),
    surveySummary: buildSurveySummary(surveyRecords),
    attemptCounts: buildAnalysisAttemptSummary(attempts),
    recentActivity: buildRecentActivity(consentRecords, surveyRecords).slice(
      0,
      4,
    ),
    operationalLogs: logs,
    attention: buildOperationalSummary(logs.entries).attention,
  }
}

async function loadDashboardInformation() {
  try {
    return {
      information: await informationRepository().list(),
      informationError: null,
    }
  } catch (error) {
    logInformationFailure("listInformation", error)
    return {
      information: [],
      informationError:
        "お知らせを取得できませんでした。時間をおいて再読み込みしてください。",
    }
  }
}
