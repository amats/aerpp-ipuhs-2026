import "server-only"
import { env } from "@aerpp/config/server/admin"
import {
  DATA_PURPOSE_LABELS,
  normalizeDataPurpose,
} from "@aerpp/firestore/data-purpose-types"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import {
  ACCESS_EVENT_FIELDS,
  ANALYSIS_RUN_FIELDS,
} from "@aerpp/firestore/participant-snapshot-types"
import type {
  DocumentData,
  QueryDocumentSnapshot,
} from "@google-cloud/firestore"
import { ANALYSIS_OUTCOME_LABELS } from "@/features/monitoring/participant-record-types"
import { firestore } from "@/lib/firestore"
import { dateMillis } from "@/lib/record-time"
import type {
  RecoveryLookup,
  RecoveryRecord,
} from "./participation-recovery-lookup-types"
import { RECOVERY_LABELS } from "./participation-recovery-types"

const RECOVERY_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "medium",
  timeStyle: "medium",
})

const timeLabel = (value: unknown) => {
  const time = dateMillis(value)
  return time === null
    ? "記録なし"
    : `${RECOVERY_TIME_FORMATTER.format(time)}（日本時間）`
}
const text = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : "記録なし"
const destinationLabel = (value: unknown) =>
  typeof value === "string" && Object.hasOwn(RECOVERY_LABELS, value)
    ? RECOVERY_LABELS[value as keyof typeof RECOVERY_LABELS]
    : text(value)

function commonFields(data: DocumentData): Array<[string, string]> {
  return [
    ["サーバー", text(data.serverId)],
    ["区分", DATA_PURPOSE_LABELS[normalizeDataPurpose(data.dataPurpose)]],
    ["ブラウザーID", text(data.clientId)],
    ["同意ID", text(data.consentId)],
  ]
}

function scoped(docs: QueryDocumentSnapshot[]) {
  return docs.filter(
    (doc) =>
      env.participantApiServerId === "all" ||
      doc.data().serverId === env.participantApiServerId,
  )
}
function newest(records: RecoveryRecord[]) {
  return records.sort(
    (a, b) => (b.time ?? 0) - (a.time ?? 0) || a.id.localeCompare(b.id),
  )
}

export async function loadRecoveryRecords(
  pseudonym: string,
): Promise<RecoveryLookup> {
  const repository = createParticipantRepository(firestore)
  // One read transaction gives the operator a consistent snapshot. Projections
  // exclude contact ciphertext, authentication credentials and answer bodies.
  return firestore.runTransaction(
    async (tx) => {
      const [stateSnapshot, businessEvents, runs, accessEvents] =
        await Promise.all([
          tx.get(repository.participationState(pseudonym)),
          tx.get(
            repository
              .participationEventsFor(pseudonym)
              .select(
                "serverId",
                "dataPurpose",
                "clientId",
                "consentId",
                "eventType",
                "documentSet",
                "consentRequestedAt",
                "consentConfirmedAt",
                "withdrawalAcceptedAt",
                "authorizedAt",
                "consumedAt",
                "usedConsentId",
                "supersededAt",
                "supersededBy",
                "destination",
                "questionnaireKind",
                "analysisId",
                "reason",
                "actorId",
                "expiresAt",
                "createdAt",
                "status",
                "retiredAt",
                "withdrawalId",
                "usedClientId",
                "usedServerId",
                "usedStudyGeneration",
              ),
          ),
          tx.get(
            repository
              .analysisRunsFor(pseudonym)
              .select(...ANALYSIS_RUN_FIELDS),
          ),
          tx.get(
            repository
              .accessEventsFor(pseudonym)
              .select(...ACCESS_EVENT_FIELDS),
          ),
        ])
      const events = { docs: [...businessEvents.docs, ...accessEvents.docs] }
      const attempts = runs
      const questionnaires = {
        docs: runs.docs.filter((doc) => {
          const data = doc.data()
          return ["createdAt", "submittedAt", "questionnaireDeletedAt"].some(
            (key) => dateMillis(data[key]) !== null,
          )
        }),
      }
      const state = stateSnapshot.data()
      const grant = state?.recoveryAuthorization
      const attemptKinds = new Map(
        attempts.docs.map((doc) => [doc.id, doc.data().questionnaireKind]),
      )
      return {
        pseudonym,
        loadedAt: Date.now(),
        serverId: env.participantApiServerId,
        state:
          state?.pseudonym === pseudonym
            ? {
                id: stateSnapshot.id,
                time: null,
                fields: [
                  ["参加状態", text(state.status)],
                  ["研究参加状態", text(state.studyStatus)],
                  ["現在の同意境界ID", text(state.consentBoundaryId)],
                  ["最後の撤回ID", text(state.lastWithdrawalId)],
                  ["撤回日時", timeLabel(state.withdrawnAt)],
                  ["撤回後の削除", text(state.cleanupStatus)],
                  ["現在の初回解析ID", text(state.initialAnalysis?.analysisId)],
                  [
                    "初回回答受理日時",
                    timeLabel(state.initialSurveyAcceptedAt),
                  ],
                  ["復旧許可ID", text(grant?.recoveryId)],
                  ["復旧先", destinationLabel(grant?.destination)],
                  ["復旧対象解析ID", text(grant?.analysisId)],
                  ["許可理由", text(grant?.reason)],
                  ["許可日時", timeLabel(grant?.authorizedAt)],
                  ["適用日時", timeLabel(grant?.consumedAt)],
                  ["適用先同意ID", text(grant?.usedConsentId)],
                ],
              }
            : null,
        events: newest(
          scoped(events.docs).map((doc) => {
            const data = doc.data()
            return {
              id: doc.id,
              eventType: data.eventType,
              time: dateMillis(
                data.recordedAt ??
                  data.retiredAt ??
                  data.authorizedAt ??
                  data.submittedAt ??
                  data.presentationRecordedAt ??
                  data.withdrawalAcceptedAt ??
                  data.consentConfirmedAt ??
                  data.consentRequestedAt ??
                  data.createdAt,
              ),
              fields: [
                ...commonFields(data),
                ["イベント", text(data.eventType)],
                ["文書セット", text(data.documentSet?.version)],
                ["文書セットSHA-256", text(data.documentSet?.sha256)],
                ["再発行対象記録", text(data.recordId)],
                ["操作担当者ID", text(data.actorId)],
                ["操作受付日時", timeLabel(data.recordedAt)],
                ["成否", text(data.outcome)],
                ["解析ID", text(data.analysisId)],
                ["同意申請日時", timeLabel(data.consentRequestedAt)],
                ["認証要求の有効期限", timeLabel(data.expiresAt)],
                ["認証状態", text(data.status)],
                ["認証廃止日時", timeLabel(data.retiredAt)],
                ["関連撤回ID", text(data.withdrawalId)],
                ["同意確認日時", timeLabel(data.consentConfirmedAt)],
                ["撤回受付日時", timeLabel(data.withdrawalAcceptedAt)],
                ...(data.eventType === "recovery_authorized"
                  ? ([
                      ["復旧先", destinationLabel(data.destination)],
                      ["対象解析ID", text(data.analysisId)],
                      ["理由", text(data.reason)],
                      ["研究者ID", text(data.actorId)],
                      ["許可日時", timeLabel(data.authorizedAt)],
                      ["適用日時", timeLabel(data.consumedAt)],
                      ["適用先同意ID", text(data.usedConsentId)],
                      ["差し替え日時", timeLabel(data.supersededAt)],
                      ["差し替え先許可ID", text(data.supersededBy)],
                    ] as Array<[string, string]>)
                  : []),
              ],
            }
          }),
        ),
        attempts: newest(
          scoped(attempts.docs).map((doc) => {
            const data = doc.data()
            return {
              id: doc.id,
              time: dateMillis(data.startedAtMs),
              fields: [
                ...commonFields(data),
                ["解析ID", text(data.analysisId ?? doc.id)],
                ["参加区分", text(data.questionnaireKind)],
                [
                  "終了状況",
                  typeof data.outcome === "string" &&
                  Object.hasOwn(ANALYSIS_OUTCOME_LABELS, data.outcome)
                    ? ANALYSIS_OUTCOME_LABELS[
                        data.outcome as keyof typeof ANALYSIS_OUTCOME_LABELS
                      ]
                    : "終了未確認",
                ],
                ["開始日時", timeLabel(data.startedAtMs)],
                ["開始受付日時", timeLabel(data.receivedAt)],
                ["終了日時", timeLabel(data.endedAtMs)],
                ["終了受付日時", timeLabel(data.outcomeReceivedAt)],
                ["結果消失の記録日時", timeLabel(data.resultUnavailableAt)],
                ["解析測定値の削除日時", timeLabel(data.attemptDeletedAt)],
                [
                  "回答・完了情報の削除日時",
                  timeLabel(data.questionnaireDeletedAt),
                ],
                ["研究データ削除の撤回ID", text(data.researchWithdrawalId)],
              ],
            }
          }),
        ),
        questionnaires: newest(
          scoped(questionnaires.docs).map((doc) => {
            const data = doc.data()
            return {
              id: doc.id,
              time: dateMillis(data.createdAt),
              fields: [
                ...commonFields(data),
                ["解析ID", text(data.analysisId ?? doc.id)],
                ["参加区分", text(attemptKinds.get(doc.id))],
                ["完了記録日時", timeLabel(data.createdAt)],
                ["表示許可日時", timeLabel(data.presentationRecordedAt)],
                ["回答提出日時", timeLabel(data.submittedAt)],
                ["復旧回答の許可ID", text(data.recoverySubmission?.recoveryId)],
                ["復旧回答の同意ID", text(data.recoverySubmission?.consentId)],
              ],
            }
          }),
        ),
      }
    },
    { readOnly: true },
  )
}
