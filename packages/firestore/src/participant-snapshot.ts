import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import {
  ACCESS_EVENT_FIELDS,
  ANALYSIS_RUN_FIELDS,
  type ParticipantResearchSnapshot,
  type ParticipantSourceDocument,
  WITHDRAWAL_JOB_FIELDS,
} from "@aerpp/firestore/participant-snapshot-types"
import { serializeFirestoreValue } from "@aerpp/firestore/values"
import {
  FieldPath,
  type Firestore,
  type Query,
  type QuerySnapshot,
} from "@google-cloud/firestore"

export type SnapshotLimits = {
  maxRecords: number
  maxBytes: number
  pageSize: number
}

// Contact fields require the explicit access-export option; credentials are never selected.
const RESEARCH_CONSENT_FIELDS = [
  "pseudonym",
  "dataPurpose",
  "consentId",
  "documentSet",
  "clientId",
  "serverId",
  "eventType",
  "consentRequestedAt",
  "consentConfirmedAt",
  "withdrawalAcceptedAt",
  "precedingWithdrawalId",
  "hasCompletedAnalysis",
  "recoveryId",
  "destination",
  "analysisId",
  "sourceOwner",
  "expectedStudyGeneration",
  "supersededBy",
  "supersededAt",
  "questionnaireKind",
  "actorId",
  "reason",
  "authorizedAt",
  "studyGeneration",
  "usedConsentId",
  "consumedAt",
  "usedClientId",
  "usedServerId",
  "usedStudyGeneration",
  "consentBoundaryId",
  "expiresAt",
  "status",
  "createdAt",
  "updatedAt",
  "expireAt",
  "retiredAt",
  "withdrawalId",
]
const RESEARCH_PARTICIPANT_FIELDS = [
  "pseudonym",
  "dataPurpose",
  "status",
  "consentBoundaryId",
  "lastWithdrawalId",
  "withdrawnAt",
  "cleanupStatus",
  "hasCompletedAnalysis",
  "updatedAt",
  "studyGeneration",
  "studyStatus",
  "initialAnalysis",
  "initialSurveyAcceptedAt",
  "recoveryAuthorization",
]

const ACCESS_AUTHENTICATION_FIELDS = [
  "pseudonym",
  "dataPurpose",
  "consentId",
  "documentSet",
  "clientId",
  "serverId",
  "encryptedEmail",
  "precedingWithdrawalId",
  "studyGeneration",
  "recoveryId",
  "status",
  "createdAt",
  "updatedAt",
  "expireAt",
]

export async function readParticipantResearchSnapshot(
  database: Firestore,
  {
    includeAccess = false,
    limits,
    signal,
  }: {
    includeAccess?: boolean
    limits?: SnapshotLimits
    signal?: AbortSignal
  } = {},
): Promise<ParticipantResearchSnapshot> {
  const repository = createParticipantRepository(database)
  return database.runTransaction(
    async (transaction) => {
      let count = 0
      let bytes = 0
      async function read(query: Query | null) {
        if (query === null) return null
        signal?.throwIfAborted()
        if (limits === undefined) return transaction.get(query)
        const docs: QuerySnapshot["docs"] = []
        let next = query.orderBy(FieldPath.documentId()).limit(limits.pageSize)
        let page: QuerySnapshot
        do {
          signal?.throwIfAborted()
          page = await transaction.get(next)
          signal?.throwIfAborted()
          for (const doc of page.docs) {
            count += 1
            bytes += Buffer.byteLength(
              JSON.stringify(serializeFirestoreValue(doc.data())),
            )
            if (count > limits.maxRecords || bytes > limits.maxBytes)
              throw new Error("Snapshot capacity exceeded")
            docs.push(doc)
          }
          const last = page.docs.at(-1)
          if (last !== undefined)
            next = query
              .orderBy(FieldPath.documentId())
              .limit(limits.pageSize)
              .startAfter(last)
        } while (page.docs.length === limits.pageSize)
        return { docs, readTime: page.readTime }
      }
      const queries = [
        repository.analysisQuestionnaires(),
        repository.analysisAttempts(),
        repository
          .participationEvents()
          .select(
            ...RESEARCH_CONSENT_FIELDS,
            ...(includeAccess ? ["encryptedEmail"] : []),
          ),
        repository.participationStates().select(...RESEARCH_PARTICIPANT_FIELDS),
        includeAccess
          ? database
              .collection("emailConfirmations")
              .select(...ACCESS_AUTHENTICATION_FIELDS)
          : null,
        includeAccess
          ? repository.analysisRuns().select(...ANALYSIS_RUN_FIELDS)
          : null,
        includeAccess
          ? repository.accessEvents().select(...ACCESS_EVENT_FIELDS)
          : null,
        includeAccess
          ? repository.withdrawalJobs().select(...WITHDRAWAL_JOB_FIELDS)
          : null,
      ]
      // Bounded exports fetch one page at a time in the same read-only snapshot.
      // Capacity failures reject the whole export, never a truncated success.
      const snapshots: (Pick<QuerySnapshot, "docs" | "readTime"> | null)[] = []
      if (limits !== undefined) {
        if (
          !Number.isSafeInteger(limits.pageSize) ||
          limits.pageSize < 1 ||
          !Number.isSafeInteger(limits.maxRecords) ||
          limits.maxRecords < 1 ||
          !Number.isSafeInteger(limits.maxBytes) ||
          limits.maxBytes < 1
        )
          throw new Error("Invalid snapshot limits")
        for (const query of queries) snapshots.push(await read(query))
      } else snapshots.push(...(await Promise.all(queries.map(read))))
      const [
        analysisQuestionnaires,
        attempts,
        participationEvents,
        participationStates,
        emailConfirmations,
        analysisRuns,
        accessEvents,
        withdrawalJobs,
      ] = snapshots
      if (
        !analysisQuestionnaires ||
        !attempts ||
        !participationEvents ||
        !participationStates
      )
        throw new Error("Incomplete snapshot")
      return {
        analysisQuestionnaires: records(analysisQuestionnaires),
        attempts: records(attempts),
        participationEvents: records(participationEvents),
        participationStates: records(participationStates),
        ...(emailConfirmations
          ? { emailConfirmations: records(emailConfirmations) }
          : {}),
        ...(analysisRuns ? { analysisRuns: records(analysisRuns) } : {}),
        ...(accessEvents ? { accessEvents: records(accessEvents) } : {}),
        ...(withdrawalJobs ? { withdrawalJobs: records(withdrawalJobs) } : {}),
        snapshotAt: analysisQuestionnaires.readTime.toDate().toISOString(),
      }
    },
    { readOnly: true },
  )
}

function records(
  snapshot: Pick<QuerySnapshot, "docs">,
): ParticipantSourceDocument[] {
  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      data: Object.fromEntries(
        Object.entries(doc.data()).map(([key, value]) => [
          key,
          serializeFirestoreValue(value),
        ]),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
