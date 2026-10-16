import { resolveDataPurposeFilter } from "@aerpp/firestore/data-purpose-types"
import {
  buildAnalysisAttemptSummary,
  buildSurveyItemSummaries,
  buildSurveySummary,
  buildSurveyUpdates,
  getConfiguredServerId,
  loadAnalysisAttempts,
  loadSurveyRecords,
} from "@/features/monitoring/participant-records"
import { buildAnalysisTimeDistribution } from "./analysis-time-distribution"

export async function loadSurveyPageData(purpose?: unknown) {
  const dataPurpose = resolveDataPurposeFilter(purpose)
  const normalizedServerId = getConfiguredServerId()
  const allAttempts = await loadAnalysisAttempts("all", dataPurpose)
  const allRecords = await loadSurveyRecords("all", dataPurpose, allAttempts)
  const records =
    normalizedServerId === "all"
      ? allRecords
      : allRecords.filter((record) => record.serverId === normalizedServerId)
  const attempts =
    normalizedServerId === "all"
      ? allAttempts
      : allAttempts.filter((record) => record.serverId === normalizedServerId)

  return {
    attempts: attempts.slice(0, 200),
    attemptCounts: buildAnalysisAttemptSummary(attempts),
    filters: {
      dataPurpose,
      serverId: normalizedServerId,
    },
    recentActivity: buildSurveyUpdates(records),
    summary: buildSurveySummary(records),
    analysisTimeDistribution: buildAnalysisTimeDistribution(
      records.map((record) => record.processingDurationSeconds),
    ),
    itemSummaries: [
      {
        kind: "initial",
        title: "初回用アンケートの項目別回答数",
        items: buildSurveyItemSummaries(records, "initial"),
      },
      {
        kind: "follow-up",
        title: "フォローアップの項目別回答数",
        items: buildSurveyItemSummaries(records, "follow-up"),
      },
    ],
    records: records.slice(0, 200),
  }
}
