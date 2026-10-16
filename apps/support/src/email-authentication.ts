import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"
import type { Runtime } from "@aerpp/config/support"
import { buildSupportUrls } from "@aerpp/config/support-routes"
import { normalizeDataPurpose } from "@aerpp/firestore/data-purpose-types"
import { isFutureFirestoreTimestamp } from "@aerpp/firestore/values"
import { SendMagicLinkRequestSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"
import { throwApiError } from "./api-errors.js"
import { parseApiRequest } from "./api-request.js"
import { completedConfirmationProof } from "./email-confirmation-record.js"
import type { Mailer } from "./mail.js"
import { MAIL_WORK_BUDGET_MS } from "./mail-constraints.js"
import { writeAccessEvent } from "./participant-audit.js"
import { readParticipationState } from "./participant-state.js"
import {
  assertRecoveryBoundary,
  assertRecoveryRecord,
  readRecovery,
  validateRecoveryTarget,
} from "./participation-recovery.js"
import { readLimit } from "./rate-limit.js"
import {
  FieldValue,
  getFirestore,
  getParticipantRepository,
  Timestamp,
} from "./storage.js"
import { parseRecordOwner, serializeCanonicalJson } from "./survey-payload.js"

export const ConfirmationSchema = z
  .object({
    consentId: z.string().regex(/^[A-Za-z0-9]{20}$/),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")
function deriveToken(key: string, nonce: string, requestHash: string) {
  return createHmac("sha256", key)
    .update(`support-email-v2\0${nonce}\0${requestHash}`)
    .digest("base64url")
}

function confirmationCredential(
  runtime: Runtime,
  credentialId: unknown,
  serverId: string,
) {
  const credential = runtime.credentials.find(
    (entry) => entry.id === credentialId,
  )
  if (
    !credential ||
    credential.serverId !== serverId ||
    credential.environment !== runtime.environment ||
    credential.revoked ||
    !credential.operations.includes("sendMagicLink") ||
    Date.now() < credential.notBeforeMs
  )
    throwApiError(
      401,
      "AUTHENTICATION_INVALID",
      "invalid authentication policy",
    )
  if (Date.now() >= credential.expiresAtMs)
    throwApiError(410, "RECEPTION_CLOSED", "backend acceptance has ended")
  if (!runtime.admissionOpen)
    throwApiError(503, "ADMISSION_CLOSED", "admission closed")
  return credential
}

export async function issueEmailConfirmation(
  value: unknown,
  credentialId: string,
  runtime: Runtime,
  mailer: Mailer,
  workDeadline = Date.now() + MAIL_WORK_BUDGET_MS,
) {
  const body = parseApiRequest(SendMagicLinkRequestSchema, value)
  // Validate the recipient policy before creating pending authentication.
  mailer.assertRecipient(body.email)
  const {
    email,
    encryptedEmail,
    expectedWithdrawalId,
    expectedRecoveryId,
    expectedStudyGeneration,
    expiresAtMs,
    consentId,
    ...owner
  } = body
  const requestHash = createHash("sha256")
    .update(serializeCanonicalJson(body))
    .digest("hex")
  const nonce = randomBytes(32).toString("base64url")
  const ref = getFirestore().collection("emailConfirmations").doc(consentId)
  const checkWorkDeadline = () => {
    if (Date.now() >= workDeadline)
      throwApiError(
        503,
        "MAIL_TEMPORARILY_UNAVAILABLE",
        "mail temporarily unavailable",
      )
  }
  checkWorkDeadline()
  const token = await getFirestore().runTransaction(async (tx) => {
    checkWorkDeadline()
    confirmationCredential(runtime, credentialId, owner.serverId)
    const state = await readParticipationState(tx, owner.pseudonym)
    if ((state.data.lastWithdrawalId ?? null) !== expectedWithdrawalId)
      throwApiError(409, "CONSENT_SUPERSEDED", "consent is no longer current")
    if (
      state.data.status === "withdrawn" &&
      state.data.cleanupStatus !== "complete"
    )
      throwApiError(
        409,
        "WITHDRAWAL_CLEANUP_PENDING",
        "withdrawal cleanup pending",
      )
    const pendingRecovery = state.data.recoveryAuthorization
    const pendingRecoveryId =
      pendingRecovery && !pendingRecovery.usedConsentId
        ? pendingRecovery.recoveryId
        : null
    if (pendingRecovery && !pendingRecovery.usedConsentId) {
      assertRecoveryBoundary(pendingRecovery, state.data)
      readRecovery(pendingRecovery)
      await assertRecoveryRecord(tx, pendingRecovery, owner.pseudonym)
    }
    if (
      state.data.status === "withdrawn" &&
      (!pendingRecovery || pendingRecovery.usedConsentId)
    )
      throwApiError(
        409,
        "RESEARCHER_AUTHORIZATION_REQUIRED",
        "researcher authorization required",
      )
    const existing = (await tx.get(ref)).data()
    const requestRef = getParticipantRepository().participationEvent(
      `authentication-request-${consentId}`,
    )
    const request = (await tx.get(requestRef)).data()
    if (!existing && request)
      throwApiError(
        401,
        "AUTHENTICATION_EXPIRED",
        "original authentication no longer available",
      )
    if (existing) {
      if (
        (existing.studyGeneration ?? null) !==
          (state.data.studyGeneration ?? null) ||
        (existing.status !== "completed" &&
          (existing.recoveryId ?? null) !== pendingRecoveryId) ||
        (existing.status === "completed" && pendingRecoveryId !== null)
      )
        throwApiError(409, "CONSENT_SUPERSEDED", "consent is no longer current")
      if (
        existing.authenticationVersion !== 2 ||
        existing.credentialId !== credentialId ||
        existing.requestHash !== requestHash
      )
        throwApiError(
          409,
          "CONSENT_REQUEST_CONFLICT",
          "consent request conflicts",
        )
      if (existing.status === "completed") return undefined
      if (!isFutureFirestoreTimestamp(existing.expireAt))
        throwApiError(401, "AUTHENTICATION_EXPIRED", "authentication expired")
      if (existing.status !== "sent" || typeof existing.tokenNonce !== "string")
        throwApiError(401, "AUTHENTICATION_INVALID", "invalid authentication")
    }
    if (
      expectedRecoveryId !== pendingRecoveryId ||
      expectedStudyGeneration !== (state.data.studyGeneration ?? null)
    )
      throwApiError(409, "CONSENT_SUPERSEDED", "consent is no longer current")
    if (expiresAtMs <= Date.now())
      throwApiError(401, "AUTHENTICATION_EXPIRED", "authentication expired")
    if (expiresAtMs > Date.now() + 65 * 60 * 1000)
      throwApiError(400, "INVALID_REQUEST", "invalid authentication deadline")
    const token = deriveToken(
      runtime.tokenKey,
      existing?.tokenNonce ?? nonce,
      requestHash,
    )
    // The stored token verifier also detects a changed derivation key on resend.
    if (existing && existing.tokenHash !== hashToken(token))
      throwApiError(401, "AUTHENTICATION_INVALID", "invalid authentication")
    const recipientKey = createHmac("sha256", runtime.tokenKey)
      .update(email.trim().toLowerCase())
      .digest("hex")
    const callerLimit = await readLimit(
      tx,
      `mail-caller:${credentialId}`,
      30,
      3600_000,
    )
    const recipientLimit = await readLimit(
      tx,
      `mail-recipient:${recipientKey}`,
      5,
      3600_000,
      Date.now(),
      60_000,
    )
    confirmationCredential(runtime, credentialId, owner.serverId)
    tx.set(callerLimit.ref, callerLimit.data)
    tx.set(recipientLimit.ref, recipientLimit.data)
    if (!existing) {
      tx.set(
        state.ref,
        { pseudonym: owner.pseudonym, status: state.data.status },
        { merge: true },
      )
      const purpose = runtime.testEmailAddresses.includes(
        email.trim().toLowerCase(),
      )
        ? "test"
        : "research"
      const deadline = Timestamp.fromMillis(expiresAtMs)
      const recoveryId =
        pendingRecovery && !pendingRecovery.usedConsentId
          ? pendingRecovery.recoveryId
          : null
      tx.create(requestRef, {
        ...owner,
        consentId,
        encryptedEmail,
        dataPurpose: purpose,
        precedingWithdrawalId: expectedWithdrawalId,
        studyGeneration: state.data.studyGeneration ?? null,
        recoveryId,
        eventType: "authentication_requested",
        consentRequestedAt: FieldValue.serverTimestamp(),
        expiresAt: deadline,
      })
      writeAccessEvent(tx, "authentication_requested", {
        ...owner,
        consentId,
        dataPurpose: purpose,
        precedingWithdrawalId: expectedWithdrawalId,
        studyGeneration: state.data.studyGeneration ?? null,
        recoveryId,
        expiresAt: deadline,
      })
      tx.create(ref, {
        ...owner,
        dataPurpose: runtime.testEmailAddresses.includes(
          email.trim().toLowerCase(),
        )
          ? "test"
          : "research",
        consentId,
        credentialId,
        requestHash,
        encryptedEmail,
        precedingWithdrawalId: expectedWithdrawalId,
        authenticationVersion: 2,
        studyGeneration: state.data.studyGeneration ?? null,
        recoveryId,
        tokenHash: hashToken(token),
        tokenNonce: nonce,
        status: "sent",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expireAt: deadline,
      })
    }
    return token
  })
  if (token) {
    checkWorkDeadline()
    const url = new URL(buildSupportUrls(runtime.baseUrl).magicCompletePage)
    url.hash = new URLSearchParams({ consentId, token }).toString()
    // Mail delivery is outside the transaction; withdrawal still fences completion.
    await mailer.send(email, url.href, workDeadline)
  }
  return { ok: true, consentId }
}

export async function consumeEmailConfirmation(
  value: unknown,
  runtime: Runtime,
) {
  const { consentId, token } = parseApiRequest(ConfirmationSchema, value)
  await getFirestore().runTransaction(async (tx) => {
    const ref = getFirestore().collection("emailConfirmations").doc(consentId)
    const record = (await tx.get(ref)).data()
    if (
      record?.authenticationVersion !== 2 ||
      record.consentId !== consentId ||
      !/^[a-f0-9]{64}$/.test(record.tokenHash ?? "") ||
      !timingSafeEqual(
        Buffer.from(record.tokenHash, "hex"),
        Buffer.from(hashToken(token), "hex"),
      )
    )
      throwApiError(401, "AUTHENTICATION_INVALID", "invalid authentication")
    const owner = parseRecordOwner(record)
    confirmationCredential(runtime, record.credentialId, owner.serverId)
    const state = await readParticipationState(tx, owner.pseudonym)
    if (
      (record.precedingWithdrawalId ?? null) !==
      (state.data.lastWithdrawalId ?? null)
    )
      throwApiError(409, "CONSENT_SUPERSEDED", "consent is no longer current")
    if (
      state.data.status === "withdrawn" &&
      state.data.cleanupStatus !== "complete"
    )
      throwApiError(
        409,
        "WITHDRAWAL_CLEANUP_PENDING",
        "withdrawal cleanup pending",
      )
    const recovery = state.data.recoveryAuthorization
    const usesRecovery =
      record.recoveryId !== null && record.recoveryId !== undefined
    if (
      (record.studyGeneration ?? null) !==
        (state.data.studyGeneration ?? null) ||
      (usesRecovery &&
        (recovery?.recoveryId !== record.recoveryId ||
          (recovery.usedConsentId && recovery.usedConsentId !== consentId))) ||
      (!usesRecovery && recovery && !recovery.usedConsentId)
    )
      throwApiError(
        409,
        "CONSENT_SUPERSEDED",
        "fresh consent after researcher authorization required",
      )
    if (state.data.status === "withdrawn" && !usesRecovery)
      throwApiError(
        409,
        "RESEARCHER_AUTHORIZATION_REQUIRED",
        "researcher authorization required",
      )
    if (record.status === "completed")
      throwApiError(409, "AUTHENTICATION_USED", "email already confirmed")
    if (!isFutureFirestoreTimestamp(record.expireAt))
      throwApiError(401, "AUTHENTICATION_EXPIRED", "authentication expired")
    if (record.status !== "sent")
      throwApiError(401, "AUTHENTICATION_INVALID", "invalid authentication")
    confirmationCredential(runtime, record.credentialId, owner.serverId)
    const destination = usesRecovery ? readRecovery(recovery) : undefined
    if (usesRecovery) {
      assertRecoveryBoundary(recovery, state.data)
      await assertRecoveryRecord(tx, recovery, owner.pseudonym)
      await validateRecoveryTarget(tx, recovery, owner.pseudonym)
    }
    writeAccessEvent(tx, "authentication_confirmed", {
      ...owner,
      consentId,
      dataPurpose: normalizeDataPurpose(record.dataPurpose),
      studyGeneration: usesRecovery
        ? record.recoveryId
        : (record.studyGeneration ?? null),
      precedingWithdrawalId: record.precedingWithdrawalId ?? null,
    })
    if (usesRecovery)
      writeAccessEvent(tx, "recovery_consumed", {
        ...owner,
        consentId,
        dataPurpose: normalizeDataPurpose(record.dataPurpose),
        recoveryId: record.recoveryId,
        studyGeneration: record.recoveryId,
      })
    tx.create(getParticipantRepository().participationEvent(consentId), {
      ...owner,
      dataPurpose: normalizeDataPurpose(record.dataPurpose),
      consentId,
      encryptedEmail: record.encryptedEmail,
      documentSet: record.documentSet,
      authenticationVersion: 2,
      studyGeneration: usesRecovery
        ? record.recoveryId
        : (record.studyGeneration ?? null),
      precedingWithdrawalId: record.precedingWithdrawalId ?? null,
      eventType: "consent",
      // Preserve the first accepted issuance request, even after authentication cleanup.
      ...(record.createdAt instanceof Timestamp
        ? { consentRequestedAt: record.createdAt }
        : {}),
      consentConfirmedAt: FieldValue.serverTimestamp(),
    })
    tx.set(
      state.ref,
      {
        pseudonym: owner.pseudonym,
        dataPurpose: normalizeDataPurpose(record.dataPurpose),
        status: "active",
        consentBoundaryId: record.precedingWithdrawalId ?? null,
        ...(usesRecovery
          ? {
              studyGeneration: record.recoveryId,
              studyStatus:
                destination?.destination === "follow-up-document"
                  ? "follow-up"
                  : "initial-pending",
              initialAnalysis:
                destination?.destination === "initial-survey"
                  ? {
                      ...owner,
                      analysisId: destination.analysisId,
                      presented: true,
                    }
                  : null,
              recoveryAuthorization: {
                ...recovery,
                usedConsentId: consentId,
                consumedAt: FieldValue.serverTimestamp(),
              },
            }
          : {}),
      },
      { merge: true },
    )
    if (usesRecovery)
      tx.update(
        getParticipantRepository().participationEvent(record.recoveryId),
        {
          usedConsentId: consentId,
          usedClientId: owner.clientId,
          usedServerId: owner.serverId,
          usedStudyGeneration: record.recoveryId,
          consumedAt: FieldValue.serverTimestamp(),
        },
      )
    tx.set(ref, {
      ...completedConfirmationProof(record),
      status: "completed",
      studyGeneration: usesRecovery
        ? record.recoveryId
        : (record.studyGeneration ?? null),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return { ok: true }
}
