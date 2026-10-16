import { z } from "zod"

// Unicode mode matches isolated surrogate code units, but not valid pairs.
// Reject them instead of repairing/normalizing content before receipt comparison.
const isWellFormedUnicode = (value: string) => !/[\uD800-\uDFFF]/u.test(value)
const WellFormedStringSchema = z.string().refine(isWellFormedUnicode)

const ParticipantIdentifierSchema = WellFormedStringSchema.min(1)
  .max(256)
  .refine(
    (s) => s.trim() === s && [...s].every((char) => char.charCodeAt(0) >= 32),
  )
const FirestoreDocumentIdSchema = ParticipantIdentifierSchema.refine(
  (s) => !s.includes("/") && s !== "." && s !== ".." && !/^__.*__$/.test(s),
)
export const ParticipantRecordOwnerSchema = z.object({
  serverId: ParticipantIdentifierSchema,
  clientId: ParticipantIdentifierSchema,
  pseudonym: ParticipantIdentifierSchema,
})
export const ConsentBoundOwnerSchema = ParticipantRecordOwnerSchema.extend({
  consentId: FirestoreDocumentIdSchema,
})
export const AnalysisWorkspaceVersionSchema = z.string().min(1).max(128)
export const DocumentSetReferenceSchema = z
  .object({
    version: z
      .string()
      .regex(/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/)
      .max(32),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export const ReadDocumentOriginalRequestSchema = z
  .object({
    pseudonym: ParticipantIdentifierSchema,
    recordId: FirestoreDocumentIdSchema,
    name: z.enum([
      "explanation.pdf",
      "plan.pdf",
      "consent.pdf",
      "withdrawal.pdf",
    ]),
  })
  .strict()
export const SendMagicLinkRequestSchema = ParticipantRecordOwnerSchema.extend({
  consentId: z.string().regex(/^[A-Za-z0-9]{20}$/),
  documentSet: DocumentSetReferenceSchema,
  expiresAtMs: z.number().int().nonnegative().max(253402300799999),
  expectedWithdrawalId: FirestoreDocumentIdSchema.nullable(),
  expectedRecoveryId: z.uuid().nullable(),
  expectedStudyGeneration: z.uuid().nullable(),
  email: z.email().max(320),
  encryptedEmail: WellFormedStringSchema.min(1).max(16384),
}).strict()
export const VerifyAuthenticationRequestSchema =
  ConsentBoundOwnerSchema.strict()
export const WithdrawParticipationRequestSchema =
  ConsentBoundOwnerSchema.extend({
    encryptedEmail: WellFormedStringSchema.min(1).max(16384),
    documentSet: DocumentSetReferenceSchema,
  }).strict()

export const GetParticipationStateRequestSchema = z
  .object({ pseudonym: ParticipantIdentifierSchema })
  .strict()

// Metadata and nested answer fields retain their JSON value types.
// Reject reserved names at every depth, including prototype and Firestore path syntax.
const RESERVED_SURVEY_FIELD_NAMES = new Set([
  "createdAt",
  "updatedAt",
  "submittedAt",
  "expireAt",
  "status",
  "_integrity",
  "consentBoundaryId",
  "studyGeneration",
  "presentationRecordedAt",
  "resultUnavailableAt",
  "unavailability",
  "recoverySubmission",
  "questionnaireKind",
  "receivedAt",
  "outcomeReceivedAt",
  "schemaVersion",
  "researchDeletedAt",
  "researchWithdrawalId",
  "attemptDeletedAt",
  "questionnaireDeletedAt",
  "dataPurpose",
  "documentSet",
  "__proto__",
  "prototype",
  "constructor",
])
function isValidSurveyFieldName(value: string) {
  return (
    /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value) &&
    !RESERVED_SURVEY_FIELD_NAMES.has(value)
  )
}

// These fields are excluded recursively from research exports.
export const PRIVATE_PARTICIPANT_FIELD_NAMES = [
  "email",
  "encryptedEmail",
  "ipAddress",
  "remoteIp",
  "remote_ip",
  "client_ip",
  "token",
  "tokenHash",
  "tokenNonce",
  "requestHash",
  "credentialId",
  "password",
  "authorization",
  "cookie",
  "cookies",
  "secret",
  "privateKey",
] as const

// Keep question IDs separate from ownership, metadata and private export fields.
const RESERVED_SURVEY_ANSWER_FIELD_NAMES = new Set([
  ...Object.keys(ConsentBoundOwnerSchema.shape),
  ...PRIVATE_PARTICIPANT_FIELD_NAMES,
  "analysisId",
  "analysisWorkspaceVersion",
  "surveyVersion",
  "modelName",
  "processingDurationSeconds",
  "documentCount",
  "documentGraphemeCount",
  "resultGraphemeCount",
])
export const SurveyAnswerFieldNameSchema = z
  .string()
  .refine(isValidSurveyFieldName, {
    message:
      "Question IDs must match [A-Za-z][A-Za-z0-9_-]{0,127} and cannot use reserved storage field names",
  })
  .refine((value) => !RESERVED_SURVEY_ANSWER_FIELD_NAMES.has(value), {
    message:
      "Question IDs cannot use submission, analysis metadata, or private export field names",
  })

function hasValidSurveyFields(
  value: unknown,
  depth = 0,
  budget = { remaining: 1000 },
  pathBytes = "_integrity.metadata".length,
): boolean {
  // Reserve two Firestore nesting levels for _integrity.metadata/answers.
  // Bound field/value overhead as well as JSON bytes for duplicated receipts.
  // Include the longest receipt prefix and Firestore's quotes around hyphenated
  // keys. Array elements add depth, but no field-path segment.
  if (depth > 18 || pathBytes > 1500 || --budget.remaining < 0) return false
  if (typeof value === "string") return isWellFormedUnicode(value)
  if (Array.isArray(value))
    return value.every(
      (item) =>
        !Array.isArray(item) &&
        hasValidSurveyFields(item, depth + 1, budget, pathBytes),
    )
  if (value !== null && typeof value === "object")
    return Object.entries(value).every(
      ([key, item]) =>
        isValidSurveyFieldName(key) &&
        hasValidSurveyFields(
          item,
          depth + 1,
          budget,
          pathBytes + 1 + key.length + (key.includes("-") ? 2 : 0),
        ),
    )
  return true
}
const SurveySubmissionRequestSchema = z
  .unknown()
  .refine((value) => hasValidSurveyFields(value))
  .pipe(
    ConsentBoundOwnerSchema.extend({
      analysisId: FirestoreDocumentIdSchema,
      analysisWorkspaceVersion: AnalysisWorkspaceVersionSchema,
    })
      .catchall(z.json())
      .refine(
        (value) =>
          !Object.hasOwn(value, "surveyVersion") &&
          new TextEncoder().encode(JSON.stringify(value)).length <= 200_000,
      ),
  )
export const RecordAnalysisCompletionRequestSchema =
  SurveySubmissionRequestSchema
export const QuestionnaireReferenceSchema = z
  .object({
    kind: z.enum(["initial", "follow-up"]),
    definitionId: z.string().regex(/^jcs-v1:sha256:[a-f0-9]{64}$/),
  })
  .strict()
export const SubmitSurveyRequestSchema = ConsentBoundOwnerSchema.extend({
  analysisId: FirestoreDocumentIdSchema,
  questionnaire: QuestionnaireReferenceSchema,
  answers: z.record(SurveyAnswerFieldNameSchema, z.string().nullable()),
})
  .strict()
  .refine(
    (value) =>
      hasValidSurveyFields(value) &&
      Object.keys(value.answers).length > 0 &&
      new TextEncoder().encode(JSON.stringify(value)).length <= 200_000,
  )

const AnalysisAttemptOwnerSchema = ConsentBoundOwnerSchema.extend({
  analysisId: FirestoreDocumentIdSchema,
})
export const RecordAnalysisOutcomeRequestSchema =
  AnalysisAttemptOwnerSchema.extend({
    outcome: z.enum(["completed", "failed", "cancelled"]),
    endedAtMs: z.number().int().nonnegative().max(8_640_000_000_000_000),
  }).strict()
export const RecordAnalysisAttemptRequestSchema = z.discriminatedUnion(
  "outcome",
  [
    AnalysisAttemptOwnerSchema.extend({
      outcome: z.literal("started"),
      startedAtMs: z.number().int().nonnegative().max(8_640_000_000_000_000),
      documentGraphemeCounts: z
        .array(z.number().int().nonnegative().max(30000))
        .min(1)
        .max(20),
    }).strict(),
    AnalysisAttemptOwnerSchema.extend({
      outcome: z.literal("presented"),
    }).strict(),
    AnalysisAttemptOwnerSchema.extend({
      outcome: z.literal("unavailable"),
      reason: z.literal("result_unavailable"),
    }).strict(),
    AnalysisAttemptOwnerSchema.extend({
      outcome: z.enum(["completed", "failed", "cancelled"]),
      endedAtMs: z.number().int().nonnegative().max(8_640_000_000_000_000),
      durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }).strict(),
  ],
)

export const InformationToneSchema = z.enum(["info", "warning", "error"])
export const AddInformationRequestSchema = z
  .object({
    // Leave 48,576 bytes below Firestore's 1 MiB document limit for field names,
    // the document name, tone and server timestamps. Count UTF-8, not characters.
    content: WellFormedStringSchema.min(1)
      .max(1_000_000)
      .refine((value) => new TextEncoder().encode(value).length <= 1_000_000),
    tone: InformationToneSchema.optional(),
    // Firestore timestamps begin at year 0001; ISO validation alone allows 0000.
    expireAt: z.iso
      .datetime()
      .refine((value) => new Date(value).getUTCFullYear() >= 1),
  })
  .strict()
