import "server-only"

import { randomInt } from "node:crypto"
import { env } from "@aerpp/config/server/web"
import {
  ErrorResponseSchema,
  type ListParticipationEventsResponse,
} from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"
import { Stage } from "@/features/app-context/stage-types"
import { readStageFromSession } from "@/features/app-context/step-state-session"
import {
  encryptEmail,
  readEmailFromSession,
  writeEmailToSession,
} from "@/features/auth/email"
import {
  type ParticipationEventRecord,
  participationEventSchema,
} from "@/features/auth/participation-event-types"
import {
  createClientId,
  createPseudonym,
  readClientIdFromSession,
  readPseudonymFromSession,
} from "@/features/identity/participant-identifiers"
import {
  readWithdrawalRequestFromSession,
  validateWithdrawalDocumentSet,
} from "@/features/withdraw/withdrawal-session"
import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import { fetchWithRetry } from "@/lib/fetch-with-retry"
import type { AppLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import {
  type ApiRequest,
  readApiErrorCode,
  safeParseApiRequest,
  safeParseApiSuccess,
} from "@/lib/participant-api-contract-helpers"
import { participantApiHeaders } from "@/lib/participant-api-headers"
import type { AppSession } from "@/lib/session"
import { sealSessionData, unsealSessionData } from "@/lib/session-seal"
import { createAuthLogger, matchesSessionEmail } from "./auth-session"
import {
  consentContextSchema,
  type PrepareConsentResult,
} from "./consent-context-types"

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
// Cover cold starts, OAuth token refresh and Gmail delivery before responding.
const MAIL_REQUEST_TIMEOUT_MS = 65_000
// Allow for Support cold starts before withdrawal acceptance and bounded cleanup.
const WITHDRAWAL_REQUEST_TIMEOUT_MS = 45_000
const DEFAULT_REQUEST_RETRIES = 0
const CONSENT_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

async function fetchParticipantApi({
  url,
  body,
  dependency,
  logger,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: {
  url: string
  body: object
  dependency: string
  logger: AppLogger
  timeoutMs?: number
}) {
  return fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...participantApiHeaders(),
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs,
      logging: {
        dependency,
        logger,
        target: "participant_api",
      },
      retries: DEFAULT_REQUEST_RETRIES,
    },
  )
}

async function loadOrCreateParticipantIdentity({
  email,
  logger,
  logEvent,
  session,
  requirePseudonym = true,
}: {
  email?: string
  logger: AppLogger
  logEvent: string
  session: AppSession
  requirePseudonym?: boolean
}): Promise<{
  clientId: string
  encryptedEmail?: string
  pseudonym?: string
} | null> {
  let clientId = await readClientIdFromSession(session)
  if (!clientId) {
    clientId = createClientId()
    if (clientId) {
      session.clientId = clientId
    }
  }
  if (!clientId) {
    logger.error({
      event: logEvent,
      operation: "client_id",
    })
    return null
  }

  let pseudonym: string | null | undefined
  if (requirePseudonym) {
    pseudonym = await readPseudonymFromSession(session)
    if (!pseudonym) {
      logger.error({
        event: logEvent,
        operation: "pseudonym",
      })
      return null
    }
  }

  if (!email) {
    if (!pseudonym) {
      return null
    }
    return { clientId, pseudonym }
  }

  const encryptedEmail = await encryptEmail(email)
  if (!encryptedEmail) {
    logger.error({
      event: logEvent,
      operation: "email_encrypt",
    })
    return null
  }

  return {
    clientId,
    encryptedEmail,
    pseudonym: pseudonym ?? undefined,
  }
}

function parseParticipationEventRecordsResponse(
  data: unknown,
): { invalidCount: number; records: ParticipationEventRecord[] } | null {
  if (!data || typeof data !== "object") {
    return null
  }

  const records = (data as ListParticipationEventsResponse).records
  if (!Array.isArray(records)) {
    return null
  }

  const parsedRecords: ParticipationEventRecord[] = []
  let invalidCount = 0
  for (const record of records) {
    const parsedRecord = participationEventSchema.safeParse(record)
    if (!parsedRecord.success) {
      invalidCount += 1
      continue
    }
    parsedRecords.push(parsedRecord.data)
  }

  return {
    invalidCount,
    records: parsedRecords,
  }
}

export async function prepareConsentForEmail(
  session: AppSession,
  email: string,
  displayedSha256 = readDisplayedDocumentSet().sha256,
): Promise<PrepareConsentResult> {
  const logger = await createAuthLogger("prepare_consent")
  try {
    const documentSet = readDisplayedDocumentSet()
    const parsedEmail = z
      .email()
      .safeParse(typeof email === "string" ? email.trim().toLowerCase() : email)
    if (!parsedEmail.success || !session.coordinationId)
      return { ok: false, reason: "consent_context_failed" }
    const pseudonym = createPseudonym(parsedEmail.data)
    if (!pseudonym) return { ok: false, reason: "consent_context_failed" }
    if (
      session.adminRecoveryPseudonym &&
      session.adminRecoveryPseudonym !== pseudonym
    )
      return { ok: false, reason: "consent_context_failed" }
    const existing = consentContextSchema.safeParse(
      session.preparedConsentContext
        ? await unsealSessionData(session.preparedConsentContext)
        : null,
    )
    const matchesPreparation =
      existing.success === true &&
      existing.data.email === parsedEmail.data &&
      existing.data.coordinationId === session.coordinationId &&
      existing.data.serverId === env.participantApiServerId &&
      existing.data.consentId === session.consentId &&
      existing.data.clientId === session.clientId &&
      existing.data.pseudonym === session.pseudonym
    const retryDispatched =
      matchesPreparation === true &&
      session.lastConsentMailId === existing.data.consentId
    if (displayedSha256 !== documentSet.sha256 && retryDispatched !== true)
      return { ok: false, reason: "document_set_changed" }
    const response = await fetchParticipantApi({
      url: env.getParticipationStateUrl,
      body: { pseudonym },
      dependency: "get_participation_state",
      logger,
    })
    const parsed = safeParseApiSuccess(
      "getParticipationState",
      await response.json().catch(() => null),
    )
    if (response.status !== 200 || !parsed.success)
      return { ok: false, reason: "consent_context_failed" }
    if (
      session.adminRecoveryId &&
      parsed.data.pendingRecovery === undefined &&
      parsed.data.studyGeneration === session.adminRecoveryId
    ) {
      // Confirmation can consume recovery before mail delivery is acknowledged
      // locally. Reuse only this dispatched owner's confirmed request, even
      // after its pending deadline. Support rechecks the exact request on send.
      // Preparation itself must not persist authentication or change identity.
      if (
        session.preparedConsentContext &&
        retryDispatched === true &&
        existing.data.expectedRecoveryId === session.adminRecoveryId &&
        existing.data.expectedWithdrawalId === parsed.data.lastWithdrawalId &&
        (await verifyAuthentication({ ...session })).ok === true
      )
        return { ok: true, consentContext: session.preparedConsentContext }
      return { ok: false, reason: "consent_context_failed" }
    }
    if (
      session.adminRecoveryId &&
      session.adminRecoveryId !== parsed.data.pendingRecovery?.recoveryId
    )
      return { ok: false, reason: "consent_context_failed" }
    if (
      session.preparedConsentContext &&
      matchesPreparation === true &&
      existing.data.expiresAtMs > Date.now() &&
      (existing.data.documentSet.sha256 === documentSet.sha256 ||
        retryDispatched) &&
      existing.data.expectedWithdrawalId === parsed.data.lastWithdrawalId &&
      existing.data.expectedRecoveryId ===
        (parsed.data.pendingRecovery?.recoveryId ?? null) &&
      existing.data.expectedStudyGeneration === parsed.data.studyGeneration
    )
      return { ok: true, consentContext: session.preparedConsentContext }
    if (displayedSha256 !== documentSet.sha256)
      return { ok: false, reason: "document_set_changed" }
    const clientId =
      (await readClientIdFromSession(session)) ?? createClientId()
    const encryptedEmail = await encryptEmail(parsedEmail.data)
    if (!clientId || !encryptedEmail)
      return { ok: false, reason: "consent_context_failed" }
    const consentId = Array.from(
      { length: 20 },
      () => CONSENT_ID_ALPHABET[randomInt(CONSENT_ID_ALPHABET.length)],
    ).join("")
    const consentContext = await sealSessionData(
      consentContextSchema.parse({
        purpose: "consent",
        documentSet,
        coordinationId: session.coordinationId,
        email: parsedEmail.data,
        expectedWithdrawalId: parsed.data.lastWithdrawalId,
        expectedRecoveryId: parsed.data.pendingRecovery?.recoveryId ?? null,
        expectedStudyGeneration: parsed.data.studyGeneration,
        consentId,
        expiresAtMs: Date.now() + 60 * 60 * 1000,
        clientId,
        serverId: env.participantApiServerId,
        pseudonym,
        encryptedEmail,
      }),
    )
    if (!consentContext) return { ok: false, reason: "consent_context_failed" }
    // Persist preparation before any external send, including across reloads.
    // Bind the identity in authority so a different tab's preparation invalidates
    // the previous stamp before either email can be sent.
    session.consentId = consentId
    session.clientId = clientId
    session.pseudonym = pseudonym
    session.email = parsedEmail.data
    session.preparedConsentContext = consentContext
    await session.save()
    return { ok: true, consentContext }
  } catch (error) {
    logger.error({
      event: LOG_EVENT.authParticipationEventRecordsFetchFailed,
      error,
    })
    return { ok: false, reason: "consent_context_failed" }
  }
}

export type SendMagicLinkEmailResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | "document_set_changed"
        | "send_failed"
        | "consent_superseded"
        | "consent_context_invalid"
        | "consent_expired"
        | "send_rate_limited"
    }

export async function sendMagicLinkEmail(
  session: AppSession,
  email: string,
  consentContext?: string,
): Promise<SendMagicLinkEmailResult> {
  const logger = await createAuthLogger("send_magic_link")
  try {
    if (!email || email.trim() === "") {
      logger.warn({
        event: LOG_EVENT.authMagicLinkFailed,
        operation: "validate_email",
        outcome: "rejected",
      })
      return { ok: false, reason: "send_failed" }
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (typeof consentContext !== "string" || consentContext.length > 16_384)
      return { ok: false, reason: "consent_context_invalid" }
    const context = consentContextSchema.safeParse(
      await unsealSessionData(consentContext),
    )
    if (
      !context.success ||
      context.data.coordinationId !== session.coordinationId ||
      context.data.email !== normalizedEmail ||
      context.data.serverId !== env.participantApiServerId ||
      context.data.consentId !== session.consentId ||
      context.data.clientId !== session.clientId ||
      context.data.pseudonym !== session.pseudonym ||
      consentContext !== session.preparedConsentContext ||
      context.data.pseudonym !== createPseudonym(normalizedEmail)
    )
      return { ok: false, reason: "consent_context_invalid" }
    // Once dispatch has started, preserve the original set even after a deployment.
    if (
      session.lastConsentMailId !== context.data.consentId &&
      context.data.documentSet.sha256 !== readDisplayedDocumentSet().sha256
    )
      return { ok: false, reason: "document_set_changed" }
    const identicalUncertainRetry =
      session.stage === Stage.unauthenticated &&
      session.lastConsentMailId === context.data.consentId
    if (
      !identicalUncertainRetry &&
      session.lastConsentMailAt !== undefined &&
      Date.now() < session.lastConsentMailAt + 60_000
    )
      return { ok: false, reason: "send_rate_limited" }
    const pseudonym = await writeEmailToSession(session, normalizedEmail)
    if (!pseudonym) {
      logger.error({
        event: LOG_EVENT.authMagicLinkFailed,
        operation: "email_write",
      })
      return { ok: false, reason: "send_failed" }
    }
    session.clientId = context.data.clientId
    const {
      purpose: _purpose,
      coordinationId: _coordinationId,
      ...requestBody
    } = context.data

    const parsedRequest = safeParseApiRequest("sendMagicLink", requestBody)
    if (!parsedRequest.success) return { ok: false, reason: "send_failed" }

    const previousMailAt = session.lastConsentMailAt
    const previousMailId = session.lastConsentMailId
    if (!identicalUncertainRetry) {
      session.lastConsentMailAt = Date.now()
      session.lastConsentMailId = context.data.consentId
      await session.save()
    }

    const response = await fetchParticipantApi({
      url: env.sendMagicLinkUrl,
      body: parsedRequest.data,
      dependency: "send_magic_link",
      logger,
      timeoutMs: MAIL_REQUEST_TIMEOUT_MS,
    })
    const responseBody = await response.json().catch(() => null)
    const failure = ErrorResponseSchema.safeParse(responseBody)
    if (
      !identicalUncertainRetry &&
      failure.success &&
      ((response.status === 429 && failure.data.code === "RATE_LIMITED") ||
        [
          "CONSENT_SUPERSEDED",
          "AUTHENTICATION_EXPIRED",
          "CONSENT_REQUEST_CONFLICT",
        ].includes(failure.data.code ?? ""))
    ) {
      // A definite pre-dispatch rejection did not send mail. Unknown outcomes
      // keep the reservation and the original retry identity.
      session.lastConsentMailAt = previousMailAt
      session.lastConsentMailId = previousMailId
      await session.save()
    }
    if (response.status === 429)
      return { ok: false, reason: "send_rate_limited" }
    if (
      response.status === 409 &&
      failure.success &&
      failure.data.code === "CONSENT_SUPERSEDED"
    )
      return { ok: false, reason: "consent_superseded" }
    if (
      failure.success &&
      ["AUTHENTICATION_EXPIRED", "CONSENT_REQUEST_CONFLICT"].includes(
        failure.data.code ?? "",
      )
    ) {
      delete session.preparedConsentContext
      await session.save()
      return {
        ok: false,
        reason:
          failure.data.code === "AUTHENTICATION_EXPIRED"
            ? "consent_expired"
            : "consent_context_invalid",
      }
    }
    const sent = safeParseApiSuccess("sendMagicLink", responseBody)
    if (
      response.status !== 200 ||
      !sent.success ||
      sent.data.consentId !== context.data.consentId
    ) {
      logger.error({
        event: LOG_EVENT.authMagicLinkFailed,
        outcome: "failed",
        statusCode: response.status,
      })
      return { ok: false, reason: "send_failed" }
    }

    session.consentId = sent.data.consentId
    logger.info({
      clientId: context.data.clientId,
      event: LOG_EVENT.authMagicLinkSent,
      outcome: "succeeded",
      pseudonym,
    })
    return { ok: true }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.authMagicLinkFailed,
    })
    return { ok: false, reason: "send_failed" }
  }
}

export type VerifyAuthenticationResult =
  | { ok: true; authVerifiedAt: string; recoveredSurveyAnalysisId?: string }
  | {
      ok: false
      reason:
        | "not_verified"
        | "auth_expired"
        | "auth_superseded"
        | "auth_invalid"
        | "auth_unavailable"
        | "initial_browser_required"
    }

export async function readPendingAdminRecovery(session: AppSession) {
  const pseudonym = session.adminRecoveryPseudonym ?? session.pseudonym
  if (!pseudonym) return undefined
  const response = await fetchParticipantApi({
    url: env.getParticipationStateUrl,
    body: { pseudonym },
    dependency: "get_participation_state",
    logger: await createAuthLogger("recovery_check"),
  })
  const parsed = safeParseApiSuccess(
    "getParticipationState",
    await response.json().catch(() => null),
  )
  if (response.status !== 200 || parsed.success !== true)
    throw new Error("Recovery verification unavailable")
  return parsed.data.pendingRecovery
}

export async function hasPendingAdminRecovery(session: AppSession) {
  return (await readPendingAdminRecovery(session)) !== undefined
}

export async function requiresAdminRecovery(session: AppSession) {
  if (session.adminRecoveryCleanupPending === true) return true
  const recovery = await readPendingAdminRecovery(session)
  return (
    recovery !== undefined && recovery.recoveryId !== session.adminRecoveryId
  )
}

export async function verifyAuthentication(
  session: AppSession,
): Promise<VerifyAuthenticationResult> {
  const logger = await createAuthLogger("verify_authentication")
  try {
    const clientId = await readClientIdFromSession(session)
    const pseudonym = await readPseudonymFromSession(session)
    if (!clientId || !pseudonym || !session.consentId)
      return { ok: false, reason: "auth_invalid" }
    const requestBody: ApiRequest<"verifyAuthentication"> = {
      consentId: session.consentId,
      serverId: env.participantApiServerId,
      clientId,
      pseudonym,
    }

    const parsedRequest = safeParseApiRequest(
      "verifyAuthentication",
      requestBody,
    )
    if (!parsedRequest.success) return { ok: false, reason: "auth_invalid" }

    const response = await fetchParticipantApi({
      url: env.verifyAuthenticationUrl,
      body: parsedRequest.data,
      dependency: "verify_auth",
      logger,
    })
    if (response.status !== 200) {
      const code = await readApiErrorCode(response)
      const reason =
        code === "INITIAL_BROWSER_REQUIRED"
          ? "initial_browser_required"
          : code === "AUTHENTICATION_PENDING"
            ? "not_verified"
            : code === "AUTHENTICATION_EXPIRED"
              ? "auth_expired"
              : ["CONSENT_SUPERSEDED", "PARTICIPATION_WITHDRAWN"].includes(
                    code ?? "",
                  )
                ? "auth_superseded"
                : [
                      "AUTHENTICATION_INVALID",
                      "OWNER_CONFLICT",
                      "OWNER_INVALID",
                    ].includes(code ?? "")
                  ? "auth_invalid"
                  : "auth_unavailable"
      return { ok: false, reason }
    }
    const verified = safeParseApiSuccess(
      "verifyAuthentication",
      await response.json(),
    )
    if (verified.success !== true) {
      logger.error({
        event: LOG_EVENT.authVerifyFailed,
        operation: "response_schema",
        outcome: "failed",
        statusCode: response.status,
      })
      return { ok: false, reason: "auth_unavailable" }
    }
    session.questionnaireKind = verified.data.questionnaireKind

    const authVerifiedAt = new Date().toISOString()
    session.authVerifiedAt = authVerifiedAt

    return {
      ok: true,
      authVerifiedAt,
      ...(verified.data.recovery?.destination === "initial-survey"
        ? { recoveredSurveyAnalysisId: verified.data.recovery.analysisId }
        : {}),
    }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.authVerifyFailed,
    })
    return { ok: false, reason: "auth_unavailable" }
  }
}

export type WithdrawParticipationResult =
  | { ok: true; cleanupPending: boolean; hasCompletedAnalysis?: boolean | null }
  | {
      ok: false
      reason: "email_mismatch" | "withdraw_failed" | "stage_mismatch"
    }

export async function prepareWithdrawalRequest(
  session: AppSession,
  email: string,
  displayedSha256 = readDisplayedDocumentSet().sha256,
) {
  const normalizedEmail = email.trim().toLowerCase()
  if (
    !matchesSessionEmail(await readEmailFromSession(session), normalizedEmail)
  )
    return { ok: false as const, reason: "email_mismatch" }
  if (readWithdrawalRequestFromSession(session)) return { ok: true as const }
  const rejection = validateWithdrawalDocumentSet(session, displayedSha256)
  if (rejection !== null) return { ok: false as const, reason: rejection }
  const documentSet = readDisplayedDocumentSet()
  const logger = await createAuthLogger("prepare_withdrawal")
  const identity = await loadOrCreateParticipantIdentity({
    email: normalizedEmail,
    logger,
    logEvent: LOG_EVENT.authWithdrawFailed,
    session,
  })
  const parsed = safeParseApiRequest("withdrawParticipation", {
    consentId: session.consentId,
    serverId: env.participantApiServerId,
    clientId: identity?.clientId,
    pseudonym: identity?.pseudonym,
    encryptedEmail: identity?.encryptedEmail,
    documentSet,
  })
  if (!parsed.success) return { ok: false as const, reason: "withdraw_failed" }
  session.withdrawalRequest = parsed.data
  await session.save()
  return { ok: true as const }
}

export async function withdrawParticipation(
  session: AppSession,
  email: string,
): Promise<WithdrawParticipationResult> {
  const logger = await createAuthLogger("withdraw_participation")
  try {
    const stage = readStageFromSession(session)
    if (
      stage !== Stage.authenticated &&
      stage !== Stage.followUp &&
      stage !== Stage.withdrawn
    ) {
      logger.warn({
        event: LOG_EVENT.authWithdrawFailed,
        operation: "stage",
        outcome: "rejected",
        stage,
      })
      return { ok: false, reason: "stage_mismatch" }
    }

    const normalizedEmail = email.trim().toLowerCase()
    const storedEmail = await readEmailFromSession(session)
    const isVerifiedEmail = matchesSessionEmail(storedEmail, normalizedEmail)
    if (!isVerifiedEmail) {
      logger.warn({
        event: LOG_EVENT.authWithdrawFailed,
        operation: "email_mismatch",
        outcome: "rejected",
      })
      return { ok: false, reason: "email_mismatch" }
    }

    const originalRequest = readWithdrawalRequestFromSession(session)
    const participantDependencies =
      originalRequest ??
      (await loadOrCreateParticipantIdentity({
        email: normalizedEmail,
        logger,
        logEvent: LOG_EVENT.authWithdrawFailed,
        session,
      }))
    if (
      !participantDependencies?.encryptedEmail ||
      !participantDependencies.pseudonym
    ) {
      return { ok: false, reason: "withdraw_failed" }
    }

    const parsedRequest = safeParseApiRequest(
      "withdrawParticipation",
      originalRequest ?? {
        consentId: session.consentId,
        serverId: env.participantApiServerId,
        clientId: participantDependencies.clientId,
        pseudonym: participantDependencies.pseudonym,
        encryptedEmail: participantDependencies.encryptedEmail,
        documentSet: readDisplayedDocumentSet(),
      },
    )
    if (!parsedRequest.success) return { ok: false, reason: "withdraw_failed" }
    // Save the prepared request before sending so response loss can be retried
    // with the original ciphertext and owner, including after a page reload.
    if (!originalRequest) {
      session.withdrawalRequest = parsedRequest.data
      await session.save()
    }
    const response = await fetchParticipantApi({
      url: env.withdrawParticipationUrl,
      body: parsedRequest.data,
      dependency: "withdraw_participation",
      logger,
      timeoutMs: WITHDRAWAL_REQUEST_TIMEOUT_MS,
    })
    if (response.status !== 200) {
      const code = await readApiErrorCode(response)
      if (
        (response.status === 503 && code === "WITHDRAWAL_CLEANUP_PENDING") ||
        (response.status === 500 && code === "WITHDRAWAL_CLEANUP_FAILED")
      )
        return { ok: true, cleanupPending: true }
      return { ok: false, reason: "withdraw_failed" }
    }
    const withdrawn = safeParseApiSuccess(
      "withdrawParticipation",
      await response.json().catch(() => undefined),
    )
    if (!withdrawn.success) {
      logger.error({
        event: LOG_EVENT.authWithdrawFailed,
        operation: "response_schema",
        outcome: "failed",
        statusCode: response.status,
      })
      return { ok: false, reason: "withdraw_failed" }
    }
    return {
      ok: true,
      cleanupPending: false,
      hasCompletedAnalysis: withdrawn.data.hasCompletedAnalysis,
    }
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.authWithdrawFailed,
    })
    return { ok: false, reason: "withdraw_failed" }
  }
}

export async function listParticipationEvents(
  pseudonym: string | null,
  options?: { requireComplete: boolean },
): Promise<ParticipationEventRecord[]> {
  const logger = await createAuthLogger("list_participation_eventss")
  try {
    if (!pseudonym) {
      logger.error({
        event: LOG_EVENT.authParticipationEventRecordsFetchFailed,
        operation: "pseudonym",
      })
      return []
    }

    const requestBody: ApiRequest<"listParticipationEvents"> = {
      pseudonym,
    }

    const response = await fetchWithRetry(
      env.listParticipationEventsUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...participantApiHeaders(),
        },
        body: JSON.stringify(requestBody),
      },
      {
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        logging: {
          dependency: "list_participation_events",
          logger,
          target: "participant_api",
        },
        retries: DEFAULT_REQUEST_RETRIES,
      },
    )
    if (response.ok !== true) {
      logger.error({
        event: LOG_EVENT.authParticipationEventRecordsFetchFailed,
        outcome: "failed",
        statusCode: response.status,
      })
      return []
    }

    const parsed = parseParticipationEventRecordsResponse(await response.json())
    if (!parsed) {
      logger.warn({
        event: LOG_EVENT.authParticipationEventRecordsInvalidSchema,
        outcome: "failed",
      })
      return []
    }

    if (parsed.invalidCount > 0) {
      logger.warn({
        event: LOG_EVENT.authParticipationEventRecordsInvalidSchema,
        invalidCount: parsed.invalidCount,
        outcome: options?.requireComplete === true ? "failed" : "partial",
      })
      if (options?.requireComplete === true) return []
    }

    return parsed.records
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.authParticipationEventRecordsFetchFailed,
    })
    return []
  }
}
