import type {
  DataPurpose,
  DataPurposeFilter,
} from "@aerpp/firestore/data-purpose-types"

export type DashboardFilters = {
  dataPurpose: DataPurposeFilter
  serverId: string
}

export type ParticipationEventRecord = {
  dataPurpose: DataPurpose
  id: string
  clientId: string
  eventAt: Date | null
  consentRequestedAt: Date | null
  eventType: string
  pseudonym: string
  serverId: string
}

export type SurveyRecord = {
  dataPurpose: DataPurpose
  id: string
  submittedAt: Date | null
  surveyKind: "initial" | "follow-up" | "unknown"
  analysisId: string | null
  analysisWorkspaceVersion: string | null
  clientId: string
  createdAt: Date | null
  documentCount: number | null
  documentGraphemeCount: number | null
  modelName: string | null
  processingDurationSeconds: number | null
  pseudonym: string
  resultGraphemeCount: number | null
  serverId: string
  definitionId: string | null
  answers: Record<string, string | null>
}

export type AnalysisAttemptRecord = {
  clientId: string
  dataPurpose: DataPurpose
  id: string
  consentId: string
  pseudonym: string
  serverId: string
  startedAt: Date | null
  outcome: "completed" | "failed" | "cancelled" | "unconfirmed"
  questionnaireKind: SurveyRecord["surveyKind"]
  documentGraphemeCounts: number[]
  durationMs: number | null
}

export const ANALYSIS_OUTCOME_LABELS = {
  completed: "解析完了",
  failed: "失敗",
  cancelled: "中断",
  unconfirmed: "終了未確認",
}

export type ParticipantSummary = {
  totalRecords: number
  trackedParticipants: number
  latestStatusCounts: Array<{
    eventType: string
    count: number
  }>
}

export type SurveySummary = {
  totalAnalyses: number
  totalResponses: number
  uniqueParticipants: number
}

export type SurveyItemSummary = {
  itemId: string
  definitionId: string | null
  responseCount: number
}

export type ActivityItem = {
  id: string
  category: "consent" | "survey"
  createdAt: Date | null
  title: string
  detail: string
  serverId: string
}
