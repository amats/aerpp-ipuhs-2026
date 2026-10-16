import { randomUUID } from "node:crypto"
import { setImmediate as yieldWork } from "node:timers/promises"
import {
  ACCESS_EVENT_FIELDS,
  ANALYSIS_RUN_FIELDS,
  WITHDRAWAL_JOB_FIELDS,
} from "@aerpp/firestore/participant-snapshot-types"
import { PRIVATE_PARTICIPANT_FIELD_NAMES } from "@aerpp/participant-api-contracts/participant-api"
import { dateMillis } from "../../lib/record-time"
import { EXPORT_CONSTRAINTS as limits } from "./export-constraints"
import { addConsentDocumentIds } from "./export-document-ids"
import { EMAIL_DECRYPTION_FAILURE } from "./export-email"
import { eligibleResearchSource } from "./research-eligibility"
import type {
  QuestionDefinition,
  QuestionnaireFiles,
  ResearchSource,
  SourceDocument,
} from "./research-types"

const CSV_SOURCE_COLUMNS =
  "sourceDocumentId is the Firestore document ID. Stored sourceDocumentId and keys beginning with data. gain one data. prefix in CSV only. Derived <column>Utc values are added only when no stored field uses that column anywhere in the file. JSON keys and values are unchanged."

// Preserve arbitrary questionnaire versions and invalid source values, while
// keeping contact and authentication fields out of research files at every depth.
const PRIVATE_FIELDS = new Set<string>(PRIVATE_PARTICIPANT_FIELD_NAMES)
function researchValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(researchValue)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRIVATE_FIELDS.has(key))
        .map(([key, item]) => [key, researchValue(item)]),
    )
  return value
}
function researchRows(rows: SourceDocument[]): SourceDocument[] {
  return rows.map(({ id, data }) => ({
    id,
    data: researchValue(data) as Record<string, unknown>,
  }))
}
function projectRows(
  rows: SourceDocument[],
  fields: readonly string[],
): SourceDocument[] {
  return rows.map(({ id, data }) => ({
    id,
    data: Object.fromEntries(
      fields
        .filter((key) => Object.hasOwn(data, key))
        .map((key) => [key, data[key]]),
    ),
  }))
}
const OWNER_FIELDS = [
  "pseudonym",
  "consentId",
  "clientId",
  "serverId",
  "dataPurpose",
]

export function buildRawExport(
  input: ResearchSource,
  definitions: Record<string, QuestionDefinition> = {},
  exportId = randomUUID(),
) {
  const eligible = eligibleResearchSource(input)
  const analysisQuestionnaires = researchRows(eligible.analysisQuestionnaires)
  const attempts = researchRows(eligible.attempts)
  return {
    manifest: {
      schemaVersion: 6,
      exportId,
      kind: "research_source_data",
      snapshotAt: input.snapshotAt,
      scope: "all_servers_all_dates_all_purposes_all_states",
      counts: {
        analysisQuestionnaires: {
          read: input.analysisQuestionnaires.length,
          exported: analysisQuestionnaires.length,
        },
        attempts: { read: input.attempts.length, exported: attempts.length },
      },
      excludedRecords:
        input.analysisQuestionnaires.length +
        input.attempts.length -
        analysisQuestionnaires.length -
        attempts.length,
      timestampEncoding:
        "Firestore seconds and nanoseconds; UTC milliseconds for *AtMs fields",
      missingEncoding:
        "Absent keys, empty strings, null and invalid values are preserved in JSON. Nonfinite numbers use firestoreNumber tags.",
      questionnaireDefinitionIds: [
        ...new Set(
          analysisQuestionnaires.flatMap(({ data }) => {
            const value = data.questionnaire
            return value !== null &&
              typeof value === "object" &&
              "definitionId" in value
              ? [value.definitionId]
              : []
          }),
        ),
      ],
      archivedQuestionnaireIds: Object.keys(definitions),
      eligibility:
        "Withdrawn participation boundaries are excluded at snapshot time. Other purposes, submissions and questionnaire versions remain included. Reconcile later withdrawals and previously exported files offline. Physically deleted records cannot be recovered.",
      fieldPolicy:
        "Contact and authentication fields are removed recursively. No document or AI-result bodies are collected. Free-text answers are retained as stored under the assumption that they contain no personal information.",
      csvEncoding:
        "UTF-8 BOM, RFC4180. Use JSON to distinguish missing keys, null and empty strings. Formula-like cells are prefixed with an apostrophe.",
      csvColumns: CSV_SOURCE_COLUMNS,
      characterUnits:
        "documentGraphemeCount/resultGraphemeCount contain grapheme counts, not model token counts",
      durationUnits:
        "processingDurationSeconds is seconds; durationMs is milliseconds. Missing terminal events do not establish failure.",
      accessData:
        "Join the separate access export by pseudonym, consentId and analysisId. Each download has its own exportId and Firestore snapshotAt.",
    },
    analysisQuestionnaires,
    attempts,
    questionnaires: definitions,
  }
}

export async function buildAccessExport(
  input: ResearchSource,
  decryptEmail: (value: string) => Promise<string>,
  identifierHashSecret: string,
  exportId = randomUUID(),
  signal?: AbortSignal,
) {
  if (!input.emailConfirmations) throw new Error("Access snapshot required")
  const participationEvents = projectRows(input.participationEvents, [
    ...OWNER_FIELDS,
    "encryptedEmail",
    "documentSet",
    "eventType",
    "consentRequestedAt",
    "consentConfirmedAt",
    "withdrawalAcceptedAt",
    "precedingWithdrawalId",
    "hasCompletedAnalysis",
    "analysisId",
    "consentBoundaryId",
    "studyGeneration",
    "recoveryId",
    "destination",
    "sourceOwner",
    "expectedStudyGeneration",
    "supersededBy",
    "supersededAt",
    "questionnaireKind",
    "actorId",
    "reason",
    "authorizedAt",
    "usedConsentId",
    "usedClientId",
    "usedServerId",
    "usedStudyGeneration",
    "consumedAt",
    "expiresAt",
    "status",
    "createdAt",
    "updatedAt",
    "expireAt",
    "retiredAt",
    "withdrawalId",
  ])
  const participationStates = projectRows(input.participationStates, [
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
  ])
  const emailConfirmations = projectRows(input.emailConfirmations, [
    ...OWNER_FIELDS,
    "encryptedEmail",
    "documentSet",
    "precedingWithdrawalId",
    "studyGeneration",
    "recoveryId",
    "status",
    "createdAt",
    "updatedAt",
    "expireAt",
  ])
  let processed = 0
  for (const { data } of [...participationEvents, ...emailConfirmations]) {
    if (signal !== undefined) {
      if (processed++ % 128 === 0) await yieldWork()
      signal.throwIfAborted()
    }
    if (!Object.hasOwn(data, "encryptedEmail")) continue
    const encryptedEmail = data.encryptedEmail
    if (encryptedEmail === null || encryptedEmail === "") {
      data.email = encryptedEmail
    } else if (typeof encryptedEmail !== "string") {
      data.email = EMAIL_DECRYPTION_FAILURE
    } else {
      try {
        data.email = await decryptEmail(encryptedEmail)
      } catch {
        data.email = EMAIL_DECRYPTION_FAILURE
      }
    }
    delete data.encryptedEmail
  }
  const runs = input.analysisRuns ?? []
  const analysisAccess = projectRows(runs, ANALYSIS_RUN_FIELDS)
  const surveyAccess = projectRows(
    runs.filter(
      ({ data }) =>
        Object.hasOwn(data, "createdAt") ||
        Object.hasOwn(data, "submittedAt") ||
        Object.hasOwn(data, "questionnaireDeletedAt"),
    ),
    ANALYSIS_RUN_FIELDS,
  )
  const collections = {
    participationEvents: addConsentDocumentIds(
      participationEvents,
      identifierHashSecret,
    ),
    participationStates,
    emailConfirmations,
    analysisAccess,
    surveyAccess,
    accessEvents: projectRows(input.accessEvents ?? [], ACCESS_EVENT_FIELDS),
    withdrawalJobs: projectRows(
      input.withdrawalJobs ?? [],
      WITHDRAWAL_JOB_FIELDS,
    ),
  }
  return {
    manifest: {
      schemaVersion: 8,
      exportId,
      kind: "participant_access_data",
      snapshotAt: input.snapshotAt,
      scope: "all_servers_all_dates_all_purposes_all_states",
      counts: Object.fromEntries(
        Object.entries(collections).map(([key, rows]) => [
          key,
          { read: rows.length, exported: rows.length },
        ]),
      ),
      excludedRecords: 0,
      emailEncoding: `email contains the decrypted address, or ${EMAIL_DECRYPTION_FAILURE} when the stored value cannot be decrypted as an email address. These rows remain included. Missing keys, null and empty strings remain distinct in JSON. No ciphertext or keys are included.`,
      documentIdEncoding:
        "participationEvents[].data.did (CSV did) reconstructs the v2 PDF ID using email, the record’s own Asia/Tokyo date, eventType, documentSet.sha256 and the shared identifier secret. Consent uses consentConfirmedAt and withdrawal uses withdrawalAcceptedAt. Same-day records with the same email, purpose and document set share a DID. Null means required email, event time, document set or withdrawal linkage is unavailable, including email decryption failures. This value is not proof of issuance or delivery.",
      fieldPolicy:
        "Explicitly selected identity, contact, consent, withdrawal and activity metadata only; no answers, credentials, tokens, request bodies, IP addresses or Cloud Logging entries.",
      activityCoverage:
        "Stored authentication status/timestamps, analysis start/end observations and survey metadata/submission timestamps. No page-view tracking. Missing submittedAt means no recorded submission, not an answered questionnaire.",
      limitations: [
        "Pending authentication challenges may expire; new request and retirement history remains separately. Historical attempts deleted before this policy cannot be reconstructed.",
        "Withdrawal retains operational run summaries, access receipts, recovery history and deletion progress while deleting research measurements and questionnaire contents. Historical activity deleted before this policy remains unavailable.",
        "Consent history uses consentRequestedAt, consentConfirmedAt and withdrawalAcceptedAt. Missing timestamps remain absent; no substitution from createdAt or another event.",
        "Missing timestamps and terminal events remain missing; no inferred events or identities.",
      ],
      timestampEncoding:
        "Firestore seconds and nanoseconds; UTC milliseconds for *AtMs fields",
      csvColumns: CSV_SOURCE_COLUMNS,
      offlineHandling:
        "Keep separately from research data. Use pseudonym/consentId/analysisId for linkage and reconcile withdrawals before research analysis.",
    },
    ...collections,
  }
}

function csvCell(value: unknown) {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
  if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text))
    text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export function toCsv(
  rows: Record<string, unknown>[],
  columns?: string[],
): string {
  const keys =
    columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))].sort()
  if (rows.length * keys.length > limits.maxCsvCells)
    throw new Error("CSV capacity exceeded")
  let bytes = 0
  const lines = [keys.map(csvCell).join(",")]
  for (const row of rows) {
    const line = keys
      .map((key) => csvCell(Object.hasOwn(row, key) ? row[key] : undefined))
      .join(",")
    bytes += Buffer.byteLength(line) + 2
    if (bytes > limits.maxFileBytes) throw new Error("CSV capacity exceeded")
    lines.push(line)
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`
}
function sourceColumn(key: string): string {
  return key === "sourceDocumentId" || key.startsWith("data.")
    ? `data.${key}`
    : key
}
export function sourceRows(rows: SourceDocument[]): Record<string, unknown>[] {
  const storedColumns = new Set(
    rows.flatMap(({ data }) => Object.keys(data).map(sourceColumn)),
  )
  return rows.map(({ id, data }) => {
    const result: Record<string, unknown> = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [sourceColumn(key), value]),
    )
    result.sourceDocumentId = id
    for (const [key, value] of Object.entries(data)) {
      const utcColumn = `${sourceColumn(key)}Utc`
      if (
        !storedColumns.has(utcColumn) &&
        value &&
        typeof value === "object" &&
        "seconds" in value
      ) {
        const milliseconds = dateMillis(value)
        if (milliseconds !== null)
          result[utcColumn] = new Date(milliseconds).toISOString()
      }
    }
    return result
  })
}
export function questionnaireRows(
  definitions: Record<string, QuestionDefinition>,
) {
  return Object.entries(definitions).flatMap(([definitionId, definition]) =>
    definition.items.flatMap((item, index) =>
      item.item_id
        ? [
            {
              definitionId,
              surveyVersion: definition.survey_version,
              order: index + 1,
              itemId: item.item_id,
              type: item.type,
              construct: item.construct,
              reverse: item.reverse,
              question: item.question_ja ?? "",
              required: item.required === true,
              options:
                item.type === "likert7"
                  ? Object.values(
                      definition.types?.find((type) => type.type === "likert7")
                        ?.labels ?? {},
                    )
                  : (item.options ?? []),
              valueLabels:
                definition.types?.find((type) => type.type === item.type)
                  ?.labels ?? {},
              storage:
                "answers[itemId] stores the chosen string label; untouched optional items store null and cleared controls store an empty string",
            },
          ]
        : [],
    ),
  )
}

export function researchFiles(
  data: ReturnType<typeof buildRawExport>,
  originals: QuestionnaireFiles,
  only?: string,
) {
  return boundedFiles(
    {
      "source.json": () => stringifyExport(data),
      "analysis-questionnaires.csv": () =>
        toCsv(sourceRows(data.analysisQuestionnaires)),
      "attempts.csv": () => toCsv(sourceRows(data.attempts)),
      "questionnaires.csv": () => toCsv(questionnaireRows(data.questionnaires)),
      ...Object.fromEntries(
        Object.entries(originals).map(([name, content]) => [
          name,
          () => content,
        ]),
      ),
      "README.txt": () =>
        `Research source export. Generated; do not edit. Retained research rows from closed withdrawal boundaries are excluded at snapshot time. Valid stored durations retain their original units; missing durations are never reconstructed from access times. JSON is authoritative for missing/invalid values and timestamp precision. Questionnaire definitions are canonical JSON retrieved by recorded definition ID. Responses without a definition ID remain unresolved; no current definition is substituted. Reconcile withdrawals offline, including previously exported copies. See source.json manifest.\n\n${CSV_SOURCE_COLUMNS}\n`,
    },
    only,
  )
}
export function accessFiles(
  data: Awaited<ReturnType<typeof buildAccessExport>>,
  only?: string,
): Record<string, string> {
  return boundedFiles(
    Object.fromEntries([
      ["source.json", () => stringifyExport(data)],
      [
        "README.txt",
        () =>
          `Participant management and access export. Generated; do not edit. Contains decrypted email addresses and linkage identifiers. If email decryption fails, email contains ${EMAIL_DECRYPTION_FAILURE} and any consent/withdrawal did is null; the row remains included. Store separately from research files. See source.json manifest for activity coverage and unavailable deleted/expired records.\n\n${CSV_SOURCE_COLUMNS}\n`,
      ],
      ...Object.entries(data)
        .filter(([key]) => key !== "manifest")
        .map(([key, rows]) => [
          ACCESS_CSV_FILES[key as keyof typeof ACCESS_CSV_FILES],
          () => toCsv(sourceRows(rows as SourceDocument[])),
        ]),
    ]),
    only,
  )
}

function boundedFiles(factories: Record<string, () => string>, only?: string) {
  const files: Record<string, string> = {}
  let bytes = 0
  for (const [name, create] of Object.entries(factories)) {
    if (only !== undefined && name !== only) continue
    const content = create()
    bytes += Buffer.byteLength(content)
    if (bytes > limits.maxFileBytes) throw new Error("Export capacity exceeded")
    files[name] = content
  }
  return files
}

function stringifyExport(value: unknown) {
  // Bound pretty-print expansion before allocating the full JSON string.
  const pending = [{ value, depth: 0 }]
  let bytes = 0
  while (pending.length > 0) {
    const item = pending.pop()
    if (item === undefined) break
    const { value, depth } = item
    bytes += 4 + depth * 4
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        bytes += Buffer.byteLength(JSON.stringify(key)) + 4 + depth * 2
        pending.push({ value: child, depth: depth + 1 })
      }
    } else bytes += Buffer.byteLength(JSON.stringify(value) ?? "null")
    if (bytes > limits.maxFileBytes) throw new Error("JSON capacity exceeded")
  }
  return JSON.stringify(value, null, 2)
}

export const ACCESS_CSV_FILES = {
  participationEvents: "participation-events.csv",
  participationStates: "participation-states.csv",
  emailConfirmations: "email-confirmations.csv",
  analysisAccess: "analysis-access.csv",
  surveyAccess: "survey-access.csv",
  accessEvents: "access-events.csv",
  withdrawalJobs: "withdrawal-jobs.csv",
} as const
