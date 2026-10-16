import { createInformationRepository } from "@aerpp/firestore/information"
import {
  firestoreTimestampToIso,
  isFutureFirestoreTimestamp,
} from "@aerpp/firestore/values"
import {
  AddInformationRequestSchema,
  GetParticipationStateRequestSchema,
  RecordAnalysisAttemptRequestSchema,
  RecordAnalysisCompletionRequestSchema,
  RecordAnalysisOutcomeRequestSchema,
  SubmitSurveyRequestSchema,
  VerifyAuthenticationRequestSchema,
  WithdrawParticipationRequestSchema,
} from "@aerpp/participant-api-contracts/participant-api"
import type { Request, Response } from "express"
import { recordAnalysisAttemptData } from "./analysis-attempt.js"
import { recordAnalysisOutcomeData } from "./analysis-outcome.js"
import { ApiError, throwApiError } from "./api-errors.js"
import { parseApiRequest } from "./api-request.js"
import { logger } from "./logger.js"
import {
  projectAnalysisRun,
  writeAccessEvent,
  writeAnalysisRun,
} from "./participant-audit.js"
import {
  assertActiveParticipation,
  assertCurrentConsent,
  deleteWithdrawnParticipantData,
  readParticipationState,
} from "./participant-state.js"
import { readRecovery } from "./participation-recovery.js"
import {
  FieldValue,
  getFirestore,
  getParticipantRepository,
} from "./storage.js"
import {
  assertStudyAnalysis,
  assertStudyBrowser,
  readStudyParticipation,
} from "./study-participation.js"
import {
  assertMatchingSurveyOwner,
  extractSurveyPayload,
  serializeCanonicalJson,
} from "./survey-payload.js"

export function sendApiErrorResponse(
  res: Response,
  error: unknown,
  operation: string = res.locals?.operation ?? "participantApi",
) {
  const known = error instanceof ApiError
  if (!known || error.status >= 500)
    logger.error(
      {
        operation,
        code: known ? error.code : "INTERNAL_ERROR",
      },
      "Support operation failed",
    )
  res.status(known ? error.status : 500).json({
    error: known ? error.message : "internal server error",
    code: known ? error.code : "INTERNAL_ERROR",
  })
}

export async function verifyAuthentication(req: Request, res: Response) {
  try {
    const owner = parseApiRequest(VerifyAuthenticationRequestSchema, req.body)
    const verified = await getFirestore().runTransaction(async (tx) => {
      const state = await readParticipationState(tx, owner.pseudonym)
      const record = (
        await tx.get(
          getFirestore().collection("emailConfirmations").doc(owner.consentId),
        )
      ).data()
      if (!record)
        throwApiError(401, "AUTHENTICATION_INVALID", "invalid authentication")
      if (record.authenticationVersion !== 2)
        throwApiError(401, "AUTHENTICATION_INVALID", "invalid authentication")
      assertMatchingSurveyOwner(record, owner)
      if (
        (record.precedingWithdrawalId ?? null) !==
        (state.data.lastWithdrawalId ?? null)
      )
        throwApiError(409, "CONSENT_SUPERSEDED", "consent is no longer current")
      if (record.status === "sent") {
        const grant = state.data.recoveryAuthorization
        const pendingRecoveryId =
          grant && !grant.usedConsentId ? grant.recoveryId : null
        if (
          (record.studyGeneration ?? null) !==
            (state.data.studyGeneration ?? null) ||
          (record.recoveryId ?? null) !== pendingRecoveryId
        )
          throwApiError(
            409,
            "CONSENT_SUPERSEDED",
            "consent is no longer current",
          )
        if (!isFutureFirestoreTimestamp(record.expireAt))
          throwApiError(401, "AUTHENTICATION_EXPIRED", "authentication expired")
        throwApiError(
          409,
          "AUTHENTICATION_PENDING",
          "email confirmation pending",
        )
      }
      if (record.status !== "completed")
        throwApiError(
          401,
          "AUTHENTICATION_INVALID",
          "invalid authentication status",
        )
      assertActiveParticipation(state)
      await assertCurrentConsent(tx, state, owner)
      const study = readStudyParticipation(state)
      assertStudyBrowser(study, owner)
      const grant = state.data.recoveryAuthorization
      const recovery =
        grant?.usedConsentId === owner.consentId
          ? readRecovery(grant)
          : undefined
      return {
        questionnaireKind: study.kind,
        ...(recovery &&
        study.kind === "initial" &&
        study.initial?.analysisId === recovery.analysisId
          ? { recovery }
          : {}),
      }
    })
    res.status(200).json({ ok: true, ...verified })
  } catch (error) {
    sendApiErrorResponse(res, error)
    return
  }
}

export async function withdrawParticipation(req: Request, res: Response) {
  // Bound cleanup separately from Web's timeout, which also covers cold starts.
  // Acknowledge acceptance even when deletion needs retries or scheduled cleanup.
  const cleanupDeadline = Date.now() + 5_000
  let recorded = false

  try {
    const body = parseApiRequest(WithdrawParticipationRequestSchema, req.body)
    const withdrawalRef = getParticipantRepository().participationEvent()
    const withdrawal = await getFirestore().runTransaction(async (tx) => {
      const state = await readParticipationState(tx, body.pseudonym)
      const consent = await assertCurrentConsent(tx, state, body, true)
      // The participation read serializes duplicate withdrawals.
      if (state.data.status !== "withdrawn") {
        const analysisQuestionnaires = await tx.get(
          getParticipantRepository()
            .analysisQuestionnairesFor(body.pseudonym)
            .limit(1),
        )
        const attempts = analysisQuestionnaires.empty
          ? await tx.get(
              getParticipantRepository().analysisAttemptsFor(body.pseudonym),
            )
          : undefined
        const hasCompletedAnalysis =
          !analysisQuestionnaires.empty ||
          attempts?.docs.some((doc) => doc.data().outcome === "completed") ===
            true
            ? true
            : attempts?.docs.every((doc) =>
                  ["failed", "cancelled"].includes(doc.data().outcome),
                ) === true
              ? false
              : null
        tx.create(withdrawalRef, {
          ...body,
          hasCompletedAnalysis,
          dataPurpose: consent.dataPurpose,
          eventType: "withdrawal",
          consentBoundaryId: consent.precedingWithdrawalId,
          withdrawalAcceptedAt: FieldValue.serverTimestamp(),
        })
        tx.create(getParticipantRepository().withdrawalJob(withdrawalRef.id), {
          schemaVersion: 1,
          pseudonym: body.pseudonym,
          withdrawalId: withdrawalRef.id,
          consentBoundaryId: consent.precedingWithdrawalId,
          acceptedAt: FieldValue.serverTimestamp(),
          status: "pending",
          deletedCount: 0,
        })
        writeAccessEvent(tx, "withdrawal_accepted", {
          ...body,
          dataPurpose: consent.dataPurpose,
          withdrawalId: withdrawalRef.id,
          consentBoundaryId: consent.precedingWithdrawalId,
        })
        tx.set(
          state.ref,
          {
            pseudonym: body.pseudonym,
            dataPurpose: consent.dataPurpose,
            status: "withdrawn",
            studyGeneration: state.data.studyGeneration ?? null,
            ...(state.data.recoveryAuthorization
              ? { recoveryAuthorization: state.data.recoveryAuthorization }
              : {}),
            consentBoundaryId: consent.precedingWithdrawalId,
            lastWithdrawalId: withdrawalRef.id,
            withdrawnAt: FieldValue.serverTimestamp(),
            cleanupStatus: "pending",
            deletedCount: 0,
            hasCompletedAnalysis,
          },
          { merge: true },
        )
        return {
          id: withdrawalRef.id,
          hasCompletedAnalysis,
          newlyAccepted: true,
        }
      }
      return {
        id: state.data.lastWithdrawalId,
        newlyAccepted: false,
        hasCompletedAnalysis:
          typeof state.data.hasCompletedAnalysis === "boolean"
            ? state.data.hasCompletedAnalysis
            : null,
      }
    })
    recorded = true
    const deletedCount = await deleteWithdrawnParticipantData(
      body.pseudonym,
      withdrawal.id,
      cleanupDeadline,
    )
    res.status(200).json({
      ok: true,
      deletedCount,
      hasCompletedAnalysis: withdrawal.hasCompletedAnalysis,
    })
  } catch (error) {
    sendApiErrorResponse(
      res,
      recorded && !(error instanceof ApiError)
        ? new ApiError(
            500,
            "WITHDRAWAL_CLEANUP_FAILED",
            "withdrawal recorded; retry to finish deletion",
          )
        : error,
    )
  }
}

function participationSummary(
  state: Awaited<ReturnType<typeof readParticipationState>>,
) {
  return {
    studyGeneration: state.data.studyGeneration ?? null,
    lastWithdrawalId: state.data.lastWithdrawalId ?? null,
    ...(state.data.recoveryAuthorization &&
    !state.data.recoveryAuthorization.usedConsentId
      ? { pendingRecovery: readRecovery(state.data.recoveryAuthorization) }
      : {}),
  }
}

export async function getParticipationState(req: Request, res: Response) {
  try {
    const { pseudonym } = parseApiRequest(
      GetParticipationStateRequestSchema,
      req.body,
    )
    const result = await getFirestore().runTransaction(async (tx) =>
      participationSummary(await readParticipationState(tx, pseudonym)),
    )
    res.status(200).json(result)
  } catch (error) {
    sendApiErrorResponse(res, error)
  }
}

export async function listParticipationEvents(req: Request, res: Response) {
  const pseudonym = req.body?.pseudonym
  if (!pseudonym) {
    res
      .status(400)
      .json({ error: "pseudonym required", code: "INVALID_REQUEST" })
    return
  }

  try {
    const result = await getFirestore().runTransaction(async (tx) => {
      const state = await readParticipationState(tx, String(pseudonym))
      const querySnapshot = await tx.get(
        getParticipantRepository().participationEventsFor(String(pseudonym)),
      )
      const records = querySnapshot.docs
        .filter((doc) =>
          ["consent", "withdrawal"].includes(doc.data().eventType),
        )
        .map((doc) => {
          const record = doc.data()
          const timestampField =
            record.eventType === "consent"
              ? "consentConfirmedAt"
              : "withdrawalAcceptedAt"
          return {
            ...record,
            id: doc.id,
            [timestampField]: firestoreTimestampToIso(record[timestampField]),
            ...(Object.hasOwn(record, "consentRequestedAt")
              ? {
                  consentRequestedAt: firestoreTimestampToIso(
                    record.consentRequestedAt,
                  ),
                }
              : {}),
          }
        })
      return {
        records,
        ...participationSummary(state),
      }
    })
    res.status(200).json(result)
    return
  } catch (error) {
    sendApiErrorResponse(res, error)
    return
  }
}

export async function recordAnalysisCompletion(req: Request, res: Response) {
  try {
    const body = parseApiRequest(
      RecordAnalysisCompletionRequestSchema,
      req.body,
    )
    await getFirestore().runTransaction(async (tx) => {
      const state = await readParticipationState(tx, body.pseudonym)
      assertActiveParticipation(state)
      const consent = await assertCurrentConsent(tx, state, body)
      const ref = getParticipantRepository().analysisQuestionnaire(
        body.analysisId,
      )
      const snapshot = await tx.get(ref)
      const existing = snapshot.data()
      const study = readStudyParticipation(state)
      const attempt = (
        await tx.get(
          getParticipantRepository().analysisAttempt(body.analysisId),
        )
      ).data()
      if (attempt?.resultUnavailableAt)
        throwApiError(
          409,
          "RESULT_UNAVAILABLE",
          "recovered output cannot be finalized",
        )
      if (existing) {
        assertMatchingSurveyOwner(existing, body)
        assertStudyAnalysis(study, body)
        if (existing.analysisId !== body.analysisId)
          return throwApiError(
            409,
            "ANALYSIS_COMPLETION_CONFLICT",
            "survey metadata conflicts",
          )
        const metadata = existing._integrity?.metadata
        if (!metadata)
          return throwApiError(
            409,
            "SURVEY_INTEGRITY_INVALID",
            "analysis completion receipt missing",
          )
        if (serializeCanonicalJson(metadata) !== serializeCanonicalJson(body))
          return throwApiError(
            409,
            "ANALYSIS_COMPLETION_CONFLICT",
            "survey metadata conflicts",
          )
        return
      }
      assertStudyAnalysis(study, body)
      if (attempt?.outcome !== "completed")
        throwApiError(
          409,
          "ANALYSIS_COMPLETION_NOT_FOUND",
          "completed attempt required",
        )
      assertMatchingSurveyOwner(attempt, body)
      tx.set(
        state.ref,
        { pseudonym: body.pseudonym, status: "active" },
        { merge: true },
      )
      const completion = {
        ...projectAnalysisRun(attempt),
        createdAt: FieldValue.serverTimestamp(),
      }
      writeAnalysisRun(tx, body.analysisId, completion)
      writeAccessEvent(tx, "analysis_completion_recorded", completion)
      tx.create(ref, {
        ...body,
        consentBoundaryId: consent.precedingWithdrawalId,
        studyGeneration: state.data.studyGeneration ?? null,
        dataPurpose: consent.dataPurpose,
        createdAt: FieldValue.serverTimestamp(),
        _integrity: { version: 1, metadata: body },
      })
    })
  } catch (error) {
    sendApiErrorResponse(res, error)
    return
  }

  res.status(200).json({ ok: true })
}

export async function submitSurvey(req: Request, res: Response) {
  try {
    const body = parseApiRequest(SubmitSurveyRequestSchema, req.body)
    const answers = extractSurveyPayload(body)
    await getFirestore().runTransaction(async (tx) => {
      const state = await readParticipationState(tx, body.pseudonym)
      assertActiveParticipation(state)
      await assertCurrentConsent(tx, state, body)
      const ref = getParticipantRepository().analysisQuestionnaire(
        body.analysisId,
      )
      const snapshot = await tx.get(ref)
      const existing = snapshot.data()
      const study = readStudyParticipation(state)
      if (!existing)
        return throwApiError(
          404,
          "ANALYSIS_COMPLETION_NOT_FOUND",
          "survey metadata not found",
        )
      const grant = state.data.recoveryAuthorization
      const recovery =
        grant?.usedConsentId === body.consentId &&
        grant?.recoveryId === state.data.studyGeneration
          ? readRecovery(grant)
          : undefined
      const recovered =
        recovery?.destination === "initial-survey" &&
        recovery.analysisId === body.analysisId
      if (recovered === true) {
        assertMatchingSurveyOwner(existing, grant.sourceOwner)
        if (
          existing.pseudonym !== body.pseudonym ||
          body.questionnaire.kind !== "initial"
        )
          throwApiError(409, "OWNER_CONFLICT", "recovery owner conflicts")
        if (study.kind === "initial") assertStudyAnalysis(study, body)
        else if (existing.recoverySubmission?.consentId !== body.consentId)
          throwApiError(409, "CONSENT_SUPERSEDED", "recovery already advanced")
      } else {
        assertMatchingSurveyOwner(existing, body)
        assertStudyAnalysis(study, body)
      }
      if (existing.analysisId !== body.analysisId)
        return throwApiError(
          409,
          "ANALYSIS_COMPLETION_CONFLICT",
          "survey metadata conflicts",
        )
      if (existing.submittedAt) {
        if (!existing._integrity?.answers)
          return throwApiError(
            409,
            "SURVEY_INTEGRITY_INVALID",
            "survey answer receipt missing",
          )
        if (
          serializeCanonicalJson(existing._integrity.answers) !==
          serializeCanonicalJson(answers)
        )
          return throwApiError(
            409,
            "SURVEY_ANSWER_CONFLICT",
            "survey answers conflict",
          )
        return
      }
      if (
        Object.keys(answers).some((key) => Object.keys(existing).includes(key))
      )
        return throwApiError(
          409,
          "SURVEY_FIELD_CONFLICT",
          "answer field conflicts with metadata",
        )
      const metadata = existing._integrity?.metadata
      if (!metadata)
        throwApiError(
          409,
          "SURVEY_INTEGRITY_INVALID",
          "analysis completion receipt missing",
        )
      if (!existing.presentationRecordedAt && recovered !== true)
        throwApiError(
          409,
          "RESULT_PRESENTATION_REQUIRED",
          "result presentation record required",
        )
      const attempt = (
        await tx.get(
          getParticipantRepository().analysisAttempt(body.analysisId),
        )
      ).data()
      if (attempt && body.questionnaire.kind !== attempt.questionnaireKind)
        throwApiError(
          409,
          "QUESTIONNAIRE_KIND_CONFLICT",
          "questionnaire kind differs from analysis",
        )
      if (study.kind === "initial")
        tx.set(
          state.ref,
          {
            studyStatus: "follow-up",
            initialAnalysis: null,
            initialSurveyAcceptedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      const submission = {
        ...projectAnalysisRun(attempt ?? existing),
        ...Object.fromEntries(
          ["createdAt", "presentationRecordedAt", "resultUnavailableAt"]
            .filter((key) => Object.hasOwn(existing, key))
            .map((key) => [key, existing[key]]),
        ),
        questionnaireKind: body.questionnaire.kind,
        submittedAt: FieldValue.serverTimestamp(),
        ...(recovered === true
          ? {
              recoverySubmission: {
                recoveryId: recovery.recoveryId,
                consentId: body.consentId,
                clientId: body.clientId,
                serverId: body.serverId,
                studyGeneration: state.data.studyGeneration ?? null,
              },
            }
          : {}),
      }
      writeAnalysisRun(tx, body.analysisId, submission)
      writeAccessEvent(tx, "questionnaire_submitted", submission)
      tx.update(ref, {
        ...answers,
        ...(recovered === true
          ? {
              recoverySubmission: {
                recoveryId: recovery.recoveryId,
                consentId: body.consentId,
                clientId: body.clientId,
                serverId: body.serverId,
                studyGeneration: state.data.studyGeneration ?? null,
              },
            }
          : {}),
        submittedAt: FieldValue.serverTimestamp(),
        _integrity: { version: 1, metadata, answers },
      })
      return true
    })
  } catch (error) {
    sendApiErrorResponse(res, error)
    return
  }

  res.status(200).json({ ok: true })
}

export async function getInformation(_req: Request, res: Response) {
  try {
    const messages = await createInformationRepository(
      getFirestore(),
    ).listMessages()
    res.status(200).json({ messages })
    return
  } catch (error) {
    sendApiErrorResponse(res, error)
    return
  }
}

export async function addInformation(req: Request, res: Response) {
  try {
    const {
      content,
      tone = "info",
      expireAt,
    } = parseApiRequest(AddInformationRequestSchema, req.body)
    await createInformationRepository(getFirestore()).add({
      content,
      tone,
      expireAt,
    })
    res.status(200).json({ ok: true })
    return
  } catch (error) {
    sendApiErrorResponse(res, error)
    return
  }
}

export async function recordAnalysisAttempt(req: Request, res: Response) {
  try {
    const body = parseApiRequest(RecordAnalysisAttemptRequestSchema, req.body)
    const recorded = await recordAnalysisAttemptData(body)
    res.status(200).json({ ok: true, ...recorded })
  } catch (error) {
    sendApiErrorResponse(res, error)
  }
}

export async function recordAnalysisOutcome(req: Request, res: Response) {
  try {
    const body = parseApiRequest(RecordAnalysisOutcomeRequestSchema, req.body)
    await recordAnalysisOutcomeData(body)
    res.status(200).json({ ok: true })
  } catch (error) {
    sendApiErrorResponse(res, error)
  }
}
