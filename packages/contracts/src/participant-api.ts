import { z } from "zod"

/**
 * Standalone HTTP contracts for copying into AERPP. The only external dependency
 * is Zod 4 (4.6.4 in this repository). Types alone do not validate runtime data:
 * call request.parse / safeParse before sending, then send the validated data as
 * JSON. Validate responses with success as well. This file does not implement
 * an HTTP client, network requests, retries, or UI state updates.
 *
 * Copying and updating:
 * - participant-api.ts works on its own; copying or loading openapi.yaml at runtime is
 *   optional. If using the YAML as a reference, use the same revision and record
 *   the source commit.
 * - Do not rely on OpenAPI info.version alone to establish implementation parity.
 *   Use the revision matching the deployed API. If you also copied the YAML,
 *   replace both files when updating.
 * - Do not edit the generated block below directly. Update packages/contracts/src/request-schemas.ts and run
 *   pnpm run contracts:sync from the workspace root.
 *   Handwritten comments are outside the generated block.
 * - OpenAPI-generated clients may not reproduce Zod's recursive key, size, and
 *   depth limits. Use these schemas to validate TypeScript inputs.
 *
 * Stored strings and indexes:
 * - Owner/analysis IDs, encryptedEmail, survey values at every depth, and
 *   information content must not contain isolated Unicode surrogate code units.
 *   Invalid strings return 400 INVALID_REQUEST before persistence. Valid emoji,
 *   combining characters and U+FFFD are preserved without normalization.
 * - Arbitrary survey fields are excluded from automatic Firestore indexing.
 *   Apply the matching index configuration before reopening survey writes;
 *   pseudonym lookups and submitted-survey counts retain their required indexes.
 *
 * Requests and success handling:
 * - Use the selected Support service origin and the fixed paths below.
 * - Send JSON with Content-Type and Accept: application/json.
 * - Every protected API requires Authorization: Bearer <credential-id>.<secret>.
 *   Add it only on the Web server; it is never a participant identity.
 * - Treat an operation as successful only when HTTP 200 is returned and the API's
 *   success schema accepts the body. A 409 is not success. APIs returning
 *   records/messages do not have an ok field.
 * - For non-200 responses, use errors.safeParse and branch on HTTP status and code.
 *   Provide failure fallbacks for network failures, non-JSON errors, unknown or
 *   missing codes, and schema mismatches on HTTP 200. Do not advance the UI to a
 *   success state in these cases.
 * - Do not branch on the English error text. Never log email addresses, encrypted
 *   email addresses, links/IDs, answers, shared keys, or raw responses/exceptions.
 *
 * Survey submission example (AERPP server; endpoint/authKey from configuration):
 * ```ts
 * const contract = ApiContracts.submitSurvey
 * const payload = contract.request.parse({
 *   analysisId: "analysis-1", serverId: "server-1", clientId: "client-1",
 *   pseudonym: "participant-1", consentId: "confirmed-consent-id",
 *   questionnaire: { kind: "initial", definitionId: `jcs-v1:sha256:${"a".repeat(64)}` },
 *   answers: { q1: "yes" },
 * })
 * const response = await fetch(endpoint, {
 *   method: contract.method,
 *   headers: {
 *     "Content-Type": "application/json", Accept: "application/json",
 *     Authorization: `Bearer ${authKey}`,
 *   },
 *   body: JSON.stringify(payload),
 * })
 * const body: unknown = await response.json().catch(() => undefined)
 * if (response.status !== 200) {
 *   const error = contract.errors.safeParse(body)
 *   // Handle UI updates/retries based on status and error.data?.code here.
 *   // Treat unknown formats as failures too; do not log the raw body.
 *   throw new Error(error.success ? error.data.code : "API_ERROR")
 * }
 * const result = contract.success.safeParse(body)
 * if (!result.success) throw new Error("INVALID_API_RESPONSE")
 * // Persist the submitted UI/cookie state after this point.
 * ```
 * Keep the original analysisId and full payload in case responses are lost while
 * saving data or updating UI state. See the ApiContracts comments and
 * ErrorResponseSchema for retry conditions and API-specific exceptions.
 */
// BEGIN GENERATED REQUEST SCHEMAS (pnpm run contracts:sync)
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
// END GENERATED REQUEST SCHEMAS

const nonEmptyString = z.string().min(1)

// API credentials are mandatory; participant ownership and consent are checked separately.
export const AuthHeadersSchema = z.object({
  Authorization: z
    .string()
    .regex(/^Bearer [A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{43,128}$/),
})

/**
 * All participant APIs return an error message and code. The string type accepts
 * future codes; handle unknown codes and invalid error bodies as failures based
 * on the HTTP status.
 *
 * Common HTTP statuses/codes and caller actions (not every API returns every code):
 * - 400 INVALID_REQUEST: Correct the input. Do not automatically resend it unchanged.
 * - 401 UNAUTHORIZED: Check shared-key configuration. Resending the user's email
 *   will not resolve this error.
 * - 401 AUTHENTICATION_INVALID: No valid completed authentication exists; this
 *   excludes pending confirmation (409 AUTHENTICATION_PENDING) and expired
 *   authentication (401 AUTHENTICATION_EXPIRED).
 * - 401 AUTHENTICATION_EXPIRED: The prepared request or authentication expired;
 *   require explicit fresh consent preparation instead of extending its deadline.
 * - 409 AUTHENTICATION_PENDING: Wait for email confirmation, then verify again.
 * - 409 CONSENT_REQUEST_CONFLICT: A retry changed the prepared request content.
 * - 403 PARTICIPATION_WITHDRAWN: Stop operations/retries from old authentication or
 *   answer sessions.
 * - 404 ANALYSIS_COMPLETION_NOT_FOUND: Submit the original metadata for the same
 *   analysisId before submitting answers.
 * - 409 OWNER_CONFLICT: The three owner fields do not match. Do not treat this as
 *   a successful save or automatically switch to another ID.
 * - 409 ANALYSIS_COMPLETION_CONFLICT / SURVEY_ANSWER_CONFLICT: Content differs from
 *   the saved content.
 * - 409 SURVEY_FIELD_CONFLICT: Answer keys overlap with existing metadata keys;
 *   review the submitted fields.
 * - 409 OWNER_INVALID / PARTICIPATION_STATE_INVALID / SURVEY_INTEGRITY_INVALID:
 *   Operators must investigate the saved state. Callers must not infer
 *   missing data boundaries or state.
 * - 503 WITHDRAWAL_CLEANUP_PENDING / 500 WITHDRAWAL_CLEANUP_FAILED:
 *   Withdrawal is committed, but deletion is incomplete. Scheduled cleanup resumes
 *   without the browser; resending the same withdrawal can also resume deletion.
 * - 500 INTERNAL_ERROR / network failure: The operation may already be committed.
 *   Retry saves and withdrawals with the original request, bounded attempts, and
 *   delays. Email sending and information creation may produce duplicates.
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
})

/**
 * JSON success body for HTTP 200. Check the HTTP status as well as the body.
 */
export const OkResponseSchema = z.object({
  ok: z.literal(true),
})

export const RecoveryDestinationSchema = z.enum([
  "initial-document",
  "initial-survey",
  "follow-up-document",
])

export const ParticipationRecoverySchema = z.object({
  recoveryId: z.uuid(),
  destination: RecoveryDestinationSchema,
  analysisId: FirestoreDocumentIdSchema.optional(),
})

export const VerifyAuthenticationResponseSchema = OkResponseSchema.extend({
  recovery: ParticipationRecoverySchema.optional(),
  questionnaireKind: z.enum(["initial", "follow-up"]),
})

// Starts return the kind captured by their transaction; other observations return ok only.
export const RecordAnalysisAttemptResponseSchema = OkResponseSchema.extend({
  questionnaireKind: z.enum(["initial", "follow-up"]).optional(),
})

/**
 * deletedCount is the cumulative number of analysisQuestionnaires deleted for this pseudonym's
 * withdrawal, excluding authentication records. Retries return the cumulative
 * count too; do not add counts from separate responses.
 * hasCompletedAnalysis is captured before deletion across the pseudonym: completed
 * attempts or survey metadata count. Only confirmed failure/cancellation or no
 * attempts establishes false; unterminated, missing or invalid evidence is null.
 * Only false permits
 * automatic return to a fresh start after server and browser cleanup confirmation.
 */
export const WithdrawParticipationResponseSchema = z.object({
  ok: z.literal(true),
  deletedCount: z.number().int().nonnegative(),
  // Fixed before deletion; missing or invalid stored evidence stays unknown.
  hasCompletedAnalysis: z.boolean().nullable(),
})

export const ConsentLookupRequestSchema = z.object({
  pseudonym: nonEmptyString,
})

/**
 * Timestamps are ISO date-time strings or null in JSON, not Firestore Timestamps.
 * consentConfirmedAt is confirmation; withdrawalAcceptedAt is withdrawal acceptance.
 * consentRequestedAt is the first server-accepted mail request, when available.
 */
const ParticipationEventRecordBaseSchema = z.object({
  id: nonEmptyString,
  serverId: z.string().optional(),
  clientId: z.string().optional(),
  pseudonym: z.string().optional(),
  encryptedEmail: z.string().optional(),
  consentId: z.string().optional(),
  precedingWithdrawalId: z.string().nullable().optional(),
  consentRequestedAt: z.iso.datetime().nullable().optional(),
  documentSet: DocumentSetReferenceSchema,
})

export const ParticipationEventRecordSchema = z.discriminatedUnion(
  "eventType",
  [
    ParticipationEventRecordBaseSchema.extend({
      eventType: z.literal("consent"),
      consentConfirmedAt: z.iso.datetime().nullable(),
    }),
    ParticipationEventRecordBaseSchema.extend({
      eventType: z.literal("withdrawal"),
      withdrawalAcceptedAt: z.iso.datetime().nullable(),
    }),
  ],
)

export const GetParticipationStateResponseSchema = z.object({
  studyGeneration: z.uuid().nullable(),
  pendingRecovery: ParticipationRecoverySchema.optional(),
  lastWithdrawalId: FirestoreDocumentIdSchema.nullable(),
}).strict()

export const ListParticipationEventsResponseSchema = GetParticipationStateResponseSchema.extend({
  records: z.array(ParticipationEventRecordSchema),
}).strip()

/**
 * Timestamps are unknown because they are unnormalized JSON from Firestore;
 * do not assume ISO strings or Date instances. Display content as plain text,
 * never insert it as HTML.
 */
export const InformationMessageSchema = z.object({
  id: nonEmptyString,
  content: z.string(),
  tone: InformationToneSchema,
  expireAt: z.unknown().optional(),
  createdAt: z.unknown().optional(),
})

export const GetInformationResponseSchema = z.object({
  messages: z.array(InformationMessageSchema),
})

/**
 * Each success schema validates an HTTP 200 body. errors validates JSON error
 * bodies; it does not cover every error format from the transport or platform.
 * Ownership consists of serverId/clientId/pseudonym plus consentId for mutations.
 * The basic AERPP flow is: consent -> sendMagicLink -> open the email link in a
 * browser -> verifyAuthentication -> recordAnalysisCompletion -> submitSurvey.
 * Mutations verify current confirmed consent, owner and study boundaries.
 * Consent requests pin documentSet through email confirmation.
 */
export const ApiContracts = {
  /**
   * A 200 means the email sending operation succeeded, not that the email arrived
   * or that the user completed verification. Check completion with
   * verifyAuthentication. Incomplete links are valid for one hour.
   * Identical retries reuse the pending identity and original documentSet; they
   * may redeliver the same link. A failure may follow committed issuance, so keep
   * the original sealed request for explicit retry.
   * Requires expectedRecoveryId and expectedStudyGeneration fixed at preparation.
   * Requires expectedWithdrawalId captured before explicit consent: null for no
   * previous withdrawal, otherwise the getParticipationState lastWithdrawalId value.
   * Prepare an unpredictable 20-character alphanumeric consentId and an absolute
   * expiresAtMs before sending. Retries retain every request field unchanged.
   * Completed requests return the same ID without mail; pending retries may
   * redeliver mail for the same ID without extending its original deadline.
   * Recipient attempts require 60-second intervals and at most five per fixed
   * hourly window across callers/consent IDs; rejection returns 429 RATE_LIMITED.
   * Preserve it on retries. A changed boundary returns CONSENT_SUPERSEDED;
   * require a fresh explicit consent action, never refresh and resend silently.
   * Returns consentId, the pending authentication ID. Store it for verification,
   * withdrawal, analysis events and analysisQuestionnaires. Only confirmed email creates consent.
   * The first accepted issuance time is kept across resends and copied to the
   * confirmed consent's consentRequestedAt; consentConfirmedAt records confirmation.
   * After withdrawal cleanup, an unused administrator grant and explicit renewed
   * consent are required to request a new link;
   * explicitly confirming from that link activates participation. Sending or
   * opening the link alone never activates it.
   */
  sendMagicLink: {
    method: "POST",
    path: "/api/participant/send-magic-link",
    headers: AuthHeadersSchema,
    request: SendMagicLinkRequestSchema,
    success: OkResponseSchema.extend({ consentId: z.string().min(1) }),
    errors: ErrorResponseSchema,
  },
  readDocumentOriginal: {
    method: "POST",
    path: "/api/participant/document-original",
    headers: AuthHeadersSchema,
    request: ReadDocumentOriginalRequestSchema,
    success: z.object({ ok: z.literal(true), documentSet: DocumentSetReferenceSchema, contentBase64: z.string().max(26_666_668), manifestJson: z.string().max(20_000) }),
    errors: ErrorResponseSchema,
  },
  // Displaying the email page does not authenticate. The browser explicitly posts the fragment token.
  magicCompletePage: {
    method: "GET",
    path: "/email/confirm",
    success: z.string(),
  },
  /**
   * Returns 200 when completed authentication matches all three owner fields,
   * has not expired, and participation has not been withdrawn.
   * Does not issue JWTs/session tokens. Pending confirmation returns 409
   * AUTHENTICATION_PENDING; expiry returns 401 AUTHENTICATION_EXPIRED.
   * Missing/invalid records return AUTHENTICATION_INVALID. Withdrawn/superseded
   * consent requires explicit recovery; service failures require retry guidance.
   */
  verifyAuthentication: {
    method: "POST",
    path: "/api/participant/verify-authentication",
    headers: AuthHeadersSchema,
    request: VerifyAuthenticationRequestSchema,
    success: VerifyAuthenticationResponseSchema,
    errors: ErrorResponseSchema,
  },
  /**
   * Requires an owner-matched, email-confirmed version-2 consent. Pending
   * authentication returns 401 AUTHENTICATION_INVALID without mutation. Retained
   * confirmed consent permits retries after authentication deletion/expiry.
   * Withdrawal covers the entire pseudonym, including other serverId/clientId
   * values using that pseudonym. It persists withdrawal first, then deletes
   * analysisQuestionnaires, analysis attempts and authentication records in batches,
   * retaining only original presentation/submission receipt timestamps with linkage.
   * A 200 means deletion is complete.
   * For WITHDRAWAL_CLEANUP_PENDING or WITHDRAWAL_CLEANUP_FAILED,
   * show "withdrawn; deletion in progress", stop
   * authentication/saves, and allow retry of the original withdrawal request. Scheduled
   * cleanup also continues without the browser/session. Do not restore
   * active participation just because a 200 was not received.
   * The same request can resume after response loss. deletedCount is cumulative;
   * do not add it across responses. Renewed participation requires explicit consent,
   * a new link requested after cleanup, and confirmation of that link.
   */
  withdrawParticipation: {
    method: "POST",
    path: "/api/participant/withdraw-participation",
    headers: AuthHeadersSchema,
    request: WithdrawParticipationRequestSchema,
    success: WithdrawParticipationResponseSchema,
    errors: ErrorResponseSchema,
  },
  /**
   * The success body is {records, lastWithdrawalId}, without ok. No history yields
   * 200 with records: [] and lastWithdrawalId: null. Both are read consistently.
   * History ordering is not guaranteed; do not use
   * the last entry as proof of current participation or authentication state.
   * Do not log the full response, as it may contain encryptedEmail.
   */
  listParticipationEvents: {
    method: "POST",
    path: "/api/participant/participation-events",
    headers: AuthHeadersSchema,
    request: ConsentLookupRequestSchema,
    success: ListParticipationEventsResponseSchema,
    errors: ErrorResponseSchema,
  },
  // Current withdrawal boundary and unused recovery grant; no history or email.
  getParticipationState: {
    method: "POST",
    path: "/api/participant/participation-state",
    headers: AuthHeadersSchema,
    request: GetParticipationStateRequestSchema,
    success: GetParticipationStateResponseSchema,
    errors: ErrorResponseSchema,
  },
  // Immutable start/terminal observations and idempotent presentation/loss events.
  // unavailable preserves inference history, releases an unpresented initial claim,
  // and permanently rejects presentation/metadata of that abandoned attempt.
  // Never include document content.
  recordAnalysisAttempt: {
    method: "POST",
    path: "/api/participant/analysis-attempt",
    headers: AuthHeadersSchema,
    request: RecordAnalysisAttemptRequestSchema,
    success: RecordAnalysisAttemptResponseSchema,
    errors: ErrorResponseSchema,
  },
  // Content-free durable terminal redelivery; never writes research or study state.
  recordAnalysisOutcome: {
    method: "POST",
    path: "/api/participant/analysis-outcome",
    headers: AuthHeadersSchema,
    request: RecordAnalysisOutcomeRequestSchema,
    success: z.object({ ok: z.literal(true) }).strict(),
    errors: ErrorResponseSchema,
  },
  /**
   * Before answers, submit {analysisId, analysisWorkspaceVersion, consentId,
   * serverId, clientId, pseudonym, ...metadataFields}.
   * Example: {analysisId:"analysis-1", serverId:"server-1", clientId:"client-1",
   *           pseudonym:"participant-1", consentId:"confirmed-consent-id",
   *           analysisWorkspaceVersion:"1.0.0", model:"model-1"}.
   * Capture analysisWorkspaceVersion when inference starts and retain it in the
   * completion receipt. Never replace it with a later build's version on retries,
   * questionnaire submission or administrator recovery.
   * The same ID, owner, and full content returns 200 even after answers have been
   * submitted. Original content/createdAt remain unchanged.
   * This API does not update differing content. Keep the initial payload and
   * resend it after response/cookie persistence failures. Do not generate a new
   * analysisId for each retry. Every metadata field participates in comparison;
   * top-level surveyVersion is rejected.
   * Place metadata fields at the request's top level; their values may contain
   * nested JSON within the schema limits. Keep these fields separate from answers:
   * the subsequent submitSurvey request repeats analysisId and the three owner
   * fields and consentId, but must not include the additional metadata fields.
   */
  recordAnalysisCompletion: {
    method: "POST",
    path: "/api/participant/analysis-completion",
    headers: AuthHeadersSchema,
    request: RecordAnalysisCompletionRequestSchema,
    success: OkResponseSchema,
    errors: ErrorResponseSchema,
  },
  /**
   * Send the same analysisId, consentId and three owner fields as the preceding metadata,
   * plus the questionnaire reference and nested answers map. See the example
   * at the top of this file.
   * Preserve JSON types; do not convert values with String(...). At every level,
   * keys must start with an ASCII letter, followed by letters, digits, hyphens,
   * or underscores, up to 128 characters. Timestamps/status/_integrity and
   * prototype-related reserved keys are prohibited (see reserved in the generated
   * schemas).
   * The entire request is limited to 200000 UTF-8 JSON bytes, 1000 values/containers,
   * and an input depth of 18. Every field path is limited to 1500 bytes, including
   * the longest storage prefix, _integrity.metadata, and quotes around keys.
   * These limits apply independently to each metadata request and each answer
   * request; byte and value/container budgets are not combined across the two.
   * Array indices do not count toward field paths. Arrays cannot be direct
   * children of arrays. Validate with the request schema before sending.
   * Resubmitting the same ID, owner, and full answers returns 200 and preserves
   * original answers/submittedAt. The questionnaire reference and all answers
   * participate in retry comparison.
   * Object key order is ignored; array order, JSON types (such as
   * "1" versus 1), and field presence are distinguished.
   * This API does not support partial updates or answer corrections. Resend the
   * original full payload, and do not treat 409 as success. Withdrawal/ownership
   * checks still apply to identical retries. Stop retrying on 403.
   */
  submitSurvey: {
    method: "POST",
    path: "/api/participant/survey",
    headers: AuthHeadersSchema,
    request: SubmitSurveyRequestSchema,
    success: OkResponseSchema,
    errors: ErrorResponseSchema,
  },
  /**
   * Creates a new information record for administrative use. If tone is omitted,
   * the server sets info (parse does not supply it).
   * content is limited to 1000000 UTF-8 bytes. Exceeding the limit returns
   * 400 INVALID_REQUEST; content is not truncated.
   * expireAt is a UTC ISO date-time string (ending in Z, years 0001 through 9999).
   * Inputs are not coerced to strings. Even identical requests create new records,
   * so automatic retries after network failures may produce duplicates.
   */
  addInformation: {
    method: "POST",
    path: "/api/operator/information",
    headers: AuthHeadersSchema,
    request: AddInformationRequestSchema,
    success: OkResponseSchema,
    errors: ErrorResponseSchema,
  },
  /**
   * GET with no body. The success body is {messages}, without ok; no matches
   * returns an empty array. Ordering and exclusion of expired records are not
   * guaranteed. Check the expireAt format and apply the display policy.
   */
  getInformation: {
    method: "GET",
    path: "/api/participant/information",
    headers: AuthHeadersSchema,
    success: GetInformationResponseSchema,
    errors: ErrorResponseSchema,
  },
} as const

export type AuthHeaders = z.infer<typeof AuthHeadersSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
export type OkResponse = z.infer<typeof OkResponseSchema>
export type WithdrawParticipationResponse = z.infer<
  typeof WithdrawParticipationResponseSchema
>
export type SendMagicLinkRequest = z.infer<typeof SendMagicLinkRequestSchema>
export type VerifyAuthenticationRequest = z.infer<
  typeof VerifyAuthenticationRequestSchema
>
export type WithdrawParticipationRequest = z.infer<
  typeof WithdrawParticipationRequestSchema
>
export type ConsentLookupRequest = z.infer<typeof ConsentLookupRequestSchema>
export type ParticipationEventRecord = z.infer<
  typeof ParticipationEventRecordSchema
>
export type ListParticipationEventsResponse = z.infer<
  typeof ListParticipationEventsResponseSchema
>
export type RecordAnalysisCompletionRequest = z.infer<
  typeof RecordAnalysisCompletionRequestSchema
>
export type SubmitSurveyRequest = z.infer<typeof SubmitSurveyRequestSchema>
export type InformationTone = z.infer<typeof InformationToneSchema>
export type AddInformationRequest = z.infer<typeof AddInformationRequestSchema>
export type InformationMessage = z.infer<typeof InformationMessageSchema>
export type GetInformationResponse = z.infer<
  typeof GetInformationResponseSchema
>
