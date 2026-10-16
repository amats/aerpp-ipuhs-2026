import "server-only"

import { env } from "@aerpp/config/server/admin"
import {
  type DataPurposeFilter,
  matchesDataPurpose,
  normalizeDataPurpose,
} from "@aerpp/firestore/data-purpose-types"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import { QuestionnaireReferenceSchema } from "@aerpp/participant-api-contracts/participant-api"
import { firestore } from "@/lib/firestore"
import { dateMillis } from "@/lib/record-time"

const participantRepository = createParticipantRepository(firestore)

import type {
  ActivityItem,
  AnalysisAttemptRecord,
  ParticipantSummary,
  ParticipationEventRecord,
  SurveyItemSummary,
  SurveyRecord,
  SurveySummary,
} from "./participant-record-types"

export type {
  ActivityItem,
  AnalysisAttemptRecord,
  DashboardFilters,
  ParticipantSummary,
  ParticipationEventRecord,
  SurveyItemSummary,
  SurveyRecord,
  SurveySummary,
} from "./participant-record-types"
export { ANALYSIS_OUTCOME_LABELS } from "./participant-record-types"

function normalizeDate(value: unknown): Date | null {
  const milliseconds = dateMillis(value)
  return milliseconds === null ? null : new Date(milliseconds)
}

function toDateLabel(value: Date | null): string {
  if (!value) {
    return "日時不明"
  }

  return `${new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)}（日本時間）`
}

function toNumberOrNull(value: unknown): number | null {
  // This is a monitoring projection. Source exports retain the stored value.
  if (typeof value === "string") {
    const text = value.trim()
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null
    value = Number(text)
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function sortByDateDesc<T>(records: T[], date: (record: T) => Date | null) {
  return [...records].sort((left, right) => {
    const leftTime = date(left)?.getTime() ?? 0
    const rightTime = date(right)?.getTime() ?? 0
    return rightTime - leftTime
  })
}

export function getConfiguredServerId(): string {
  return env.participantApiServerId
}

function getRecordServerId(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "unknown"
}

export async function loadParticipationEventRecords(
  selectedServerId: string,
  dataPurpose: DataPurposeFilter = "research",
) {
  const snapshot = await participantRepository
    .participationEvents()
    .select(
      "pseudonym",
      "dataPurpose",
      "clientId",
      "serverId",
      "eventType",
      "consentRequestedAt",
      "consentConfirmedAt",
      "withdrawalAcceptedAt",
    )
    .get()
  const records = snapshot.docs
    .filter((doc) => ["consent", "withdrawal"].includes(doc.data().eventType))
    .map<ParticipationEventRecord>((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        dataPurpose: normalizeDataPurpose(data.dataPurpose),
        clientId: typeof data.clientId === "string" ? data.clientId : "",
        consentRequestedAt: normalizeDate(data.consentRequestedAt),
        eventAt: normalizeDate(
          data.eventType === "consent"
            ? data.consentConfirmedAt
            : data.eventType === "withdrawal"
              ? data.withdrawalAcceptedAt
              : undefined,
        ),
        eventType:
          typeof data.eventType === "string" ? data.eventType : "unknown",
        pseudonym: typeof data.pseudonym === "string" ? data.pseudonym : doc.id,
        serverId: getRecordServerId(data.serverId),
      }
    })

  const filtered =
    selectedServerId === "all"
      ? records
      : records.filter((record) => record.serverId === selectedServerId)

  return filtered
    .filter((record) => matchesDataPurpose(record.dataPurpose, dataPurpose))
    .sort(
      (left, right) =>
        (right.eventAt?.getTime() ?? 0) - (left.eventAt?.getTime() ?? 0),
    )
}

export async function loadSurveyRecords(
  selectedServerId: string,
  dataPurpose: DataPurposeFilter = "research",
  attempts: readonly AnalysisAttemptRecord[] = [],
  { includeAnswers = true }: { includeAnswers?: boolean } = {},
) {
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]))
  const snapshot = await participantRepository
    .analysisQuestionnaires()
    .select(
      "pseudonym",
      "dataPurpose",
      "analysisId",
      "analysisWorkspaceVersion",
      "consentId",
      "clientId",
      "serverId",
      "createdAt",
      "submittedAt",
      "documentCount",
      "documentGraphemeCount",
      "resultGraphemeCount",
      "processingDurationSeconds",
      "modelName",
      "questionnaire",
      ...(includeAnswers === true ? ["answers"] : []),
    )
    .get()
  const records = snapshot.docs.map<SurveyRecord>((doc) => {
    const data = doc.data()
    const questionnaire = QuestionnaireReferenceSchema.safeParse(
      data.questionnaire,
    )
    const attempt = attemptsById.get(doc.id)
    const matchingAttempt =
      attempt &&
      data.analysisId === doc.id &&
      (["clientId", "pseudonym", "serverId", "consentId"] as const).every(
        (key) =>
          typeof data[key] === "string" &&
          data[key] !== "" &&
          data[key] === attempt[key],
      )
    return {
      id: doc.id,
      dataPurpose: normalizeDataPurpose(data.dataPurpose),
      submittedAt: normalizeDate(data.submittedAt),
      surveyKind: matchingAttempt ? attempt.questionnaireKind : "unknown",
      analysisId: typeof data.analysisId === "string" ? data.analysisId : null,
      analysisWorkspaceVersion:
        typeof data.analysisWorkspaceVersion === "string"
          ? data.analysisWorkspaceVersion
          : null,
      clientId: typeof data.clientId === "string" ? data.clientId : "",
      createdAt: normalizeDate(data.createdAt),
      documentCount: toNumberOrNull(data.documentCount),
      documentGraphemeCount: toNumberOrNull(data.documentGraphemeCount),
      modelName: typeof data.modelName === "string" ? data.modelName : null,
      processingDurationSeconds: toNumberOrNull(data.processingDurationSeconds),
      pseudonym: typeof data.pseudonym === "string" ? data.pseudonym : doc.id,
      resultGraphemeCount: toNumberOrNull(data.resultGraphemeCount),
      serverId: getRecordServerId(data.serverId),
      // Stored answer keys include unanswered items; definitions are ZIP-only inputs.
      definitionId:
        questionnaire.success === true ? questionnaire.data.definitionId : null,
      answers: Object.fromEntries(
        Object.entries(
          data.answers !== null &&
            typeof data.answers === "object" &&
            Array.isArray(data.answers) !== true
            ? data.answers
            : {},
        ).filter(
          (entry): entry is [string, string | null] =>
            typeof entry[1] === "string" || entry[1] === null,
        ),
      ),
    }
  })

  const filtered =
    selectedServerId === "all"
      ? records
      : records.filter((record) => record.serverId === selectedServerId)

  return sortByDateDesc(
    filtered.filter((record) =>
      matchesDataPurpose(record.dataPurpose, dataPurpose),
    ),
    (record) => record.createdAt,
  )
}

export async function loadAnalysisAttempts(
  selectedServerId: string,
  dataPurpose: DataPurposeFilter = "research",
) {
  const snapshot = await participantRepository
    .analysisAttempts()
    .select(
      "pseudonym",
      "dataPurpose",
      "consentId",
      "clientId",
      "serverId",
      "startedAtMs",
      "outcome",
      "questionnaireKind",
      "documentGraphemeCounts",
      "durationMs",
    )
    .get()
  const records = snapshot.docs.map<AnalysisAttemptRecord>((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      dataPurpose: normalizeDataPurpose(data.dataPurpose),
      clientId: typeof data.clientId === "string" ? data.clientId : "",
      consentId: typeof data.consentId === "string" ? data.consentId : "",
      pseudonym: typeof data.pseudonym === "string" ? data.pseudonym : doc.id,
      serverId: getRecordServerId(data.serverId),
      startedAt: normalizeDate(data.startedAtMs),
      outcome: ["completed", "failed", "cancelled"].includes(data.outcome)
        ? data.outcome
        : "unconfirmed",
      questionnaireKind:
        data.questionnaireKind === "initial"
          ? "initial"
          : data.questionnaireKind === "follow-up"
            ? "follow-up"
            : "unknown",
      documentGraphemeCounts: Array.isArray(data.documentGraphemeCounts)
        ? data.documentGraphemeCounts
            .map(toNumberOrNull)
            .filter(
              (value: number | null): value is number =>
                value !== null && Number.isSafeInteger(value) && value >= 0,
            )
        : [],
      durationMs: toNumberOrNull(data.durationMs),
    }
  })
  return sortByDateDesc(
    (selectedServerId === "all"
      ? records
      : records.filter((record) => record.serverId === selectedServerId)
    ).filter((record) => matchesDataPurpose(record.dataPurpose, dataPurpose)),
    (record) => record.startedAt,
  )
}

export function buildAnalysisAttemptSummary(
  attempts: readonly AnalysisAttemptRecord[],
) {
  return {
    total: attempts.length,
    completed: attempts.filter((record) => record.outcome === "completed")
      .length,
    failed: attempts.filter((record) => record.outcome === "failed").length,
    cancelled: attempts.filter((record) => record.outcome === "cancelled")
      .length,
    unconfirmed: attempts.filter((record) => record.outcome === "unconfirmed")
      .length,
  }
}

export function buildParticipantSummary(
  records: ParticipationEventRecord[],
  history: ParticipationEventRecord[] = records,
): ParticipantSummary {
  const latestByParticipant = new Map<string, ParticipationEventRecord>()
  const participantKey = (record: ParticipationEventRecord) =>
    record.pseudonym !== ""
      ? record.pseudonym
      : record.clientId !== ""
        ? record.clientId
        : record.id
  const participants = new Set(records.map(participantKey))

  // Server and purpose filters select participants, not their withdrawal history.
  for (const record of history) {
    const key = participantKey(record)
    if (participants.has(key) && latestByParticipant.has(key) !== true) {
      latestByParticipant.set(key, record)
    }
  }

  const counts = new Map<string, number>()
  for (const record of latestByParticipant.values()) {
    counts.set(record.eventType, (counts.get(record.eventType) ?? 0) + 1)
  }

  return {
    totalRecords: records.length,
    trackedParticipants: latestByParticipant.size,
    latestStatusCounts: [...counts.entries()]
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((left, right) => right.count - left.count),
  }
}

export function buildSurveySummary(records: SurveyRecord[]): SurveySummary {
  const submitted = records.filter((record) => record.submittedAt !== null)
  return {
    totalAnalyses: records.length,
    totalResponses: submitted.length,
    uniqueParticipants: new Set(submitted.map((record) => record.pseudonym))
      .size,
  }
}

export function buildSurveyItemSummaries(
  records: SurveyRecord[],
  kind: "initial" | "follow-up",
): SurveyItemSummary[] {
  const summaries = new Map<string, SurveyItemSummary>()
  for (const record of records) {
    if (record.submittedAt === null || record.surveyKind !== kind) continue
    for (const [itemId, answer] of Object.entries(record.answers)) {
      const key = `${record.definitionId ?? "unknown"}/${itemId}`
      const item = summaries.get(key) ?? {
        itemId,
        definitionId: record.definitionId,
        responseCount: 0,
      }
      if (typeof answer === "string" && answer.trim() !== "")
        item.responseCount++
      summaries.set(key, item)
    }
  }
  return [...summaries.values()].sort(
    (a, b) =>
      (a.definitionId ?? "").localeCompare(b.definitionId ?? "") ||
      a.itemId.localeCompare(b.itemId),
  )
}

export function buildConsentUpdates(
  records: ParticipationEventRecord[],
): ActivityItem[] {
  return records.slice(0, 8).map((record) => ({
    id: `consent-${record.id}`,
    category: "consent" as const,
    createdAt: record.eventAt,
    title: `${record.pseudonym} が ${record.eventType}`,
    detail: `${toDateLabel(record.eventAt)} / serverId: ${record.serverId}`,
    serverId: record.serverId,
  }))
}

export function buildSurveyUpdates(records: SurveyRecord[]): ActivityItem[] {
  return records
    .filter((record) => record.submittedAt !== null)
    .sort(
      (left, right) =>
        (right.submittedAt?.getTime() ?? 0) -
        (left.submittedAt?.getTime() ?? 0),
    )
    .slice(0, 8)
    .map((record) => ({
      id: `survey-${record.id}`,
      category: "survey" as const,
      createdAt: record.submittedAt,
      title: `${record.pseudonym} がアンケート回答`,
      detail: `${toDateLabel(record.submittedAt)} / serverId: ${record.serverId}`,
      serverId: record.serverId,
    }))
}

export function buildRecentActivity(
  consentRecords: ParticipationEventRecord[],
  surveyRecords: SurveyRecord[],
): ActivityItem[] {
  return [
    ...buildConsentUpdates(consentRecords),
    ...buildSurveyUpdates(surveyRecords),
  ]
    .sort((left, right) => {
      const leftTime = left.createdAt?.getTime() ?? 0
      const rightTime = right.createdAt?.getTime() ?? 0
      return rightTime - leftTime
    })
    .slice(0, 8)
}

export function formatDateTime(value: Date | null): string {
  return toDateLabel(value)
}
