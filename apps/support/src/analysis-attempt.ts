import type { RecordAnalysisAttemptRequestSchema } from "@aerpp/participant-api-contracts/participant-api"
import type { z } from "zod"
import { throwApiError } from "./api-errors.js"
import {
  projectAnalysisRun,
  writeAccessEvent,
  writeAnalysisRun,
} from "./participant-audit.js"
import {
  assertActiveParticipation,
  assertCurrentConsent,
  readParticipationState,
} from "./participant-state.js"
import {
  FieldValue,
  getFirestore,
  getParticipantRepository,
  Timestamp,
} from "./storage.js"
import {
  assertStudyAnalysis,
  readStudyParticipation,
} from "./study-participation.js"
import {
  assertMatchingSurveyOwner,
  serializeCanonicalJson,
} from "./survey-payload.js"

export async function recordAnalysisAttemptData(
  body: z.infer<typeof RecordAnalysisAttemptRequestSchema>,
) {
  return getFirestore().runTransaction(async (tx) => {
    const state = await readParticipationState(tx, body.pseudonym)
    const ref = getParticipantRepository().analysisAttempt(body.analysisId)
    const existing = (await tx.get(ref)).data()
    const run = (
      await tx.get(getParticipantRepository().analysisRun(body.analysisId))
    ).data()
    if (
      body.outcome === "completed" ||
      body.outcome === "failed" ||
      body.outcome === "cancelled"
    ) {
      const originalConsent = (
        await tx.get(
          getParticipantRepository().participationEvent(body.consentId),
        )
      ).data()
      const original = run ?? existing
      if (
        run?.outcomeReceivedAt &&
        (run.outcome !== body.outcome || run.endedAtMs !== body.endedAtMs)
      )
        throwApiError(
          409,
          "ANALYSIS_EVENT_CONFLICT",
          "terminal observation conflicts",
        )
      const historical =
        state.data.status === "withdrawn" ||
        (originalConsent?.studyGeneration ?? null) !==
          (state.data.studyGeneration ?? null) ||
        (originalConsent?.precedingWithdrawalId ?? null) !==
          (state.data.consentBoundaryId ?? null) ||
        (state.data.recoveryAuthorization !== undefined &&
          state.data.recoveryAuthorization !== null &&
          !state.data.recoveryAuthorization.usedConsentId)
      if (historical === true) {
        if (
          !original ||
          originalConsent?.authenticationVersion !== 2 ||
          originalConsent.eventType !== "consent" ||
          !(original.receivedAt instanceof Timestamp) ||
          typeof original.startedAtMs !== "number" ||
          !Number.isFinite(original.startedAtMs) ||
          (Object.hasOwn(original, "studyGeneration") &&
            (original.studyGeneration ?? null) !==
              (originalConsent.studyGeneration ?? null)) ||
          (Object.hasOwn(original, "consentBoundaryId") &&
            original.consentBoundaryId !==
              (originalConsent.precedingWithdrawalId ?? null))
        )
          throwApiError(
            409,
            "ANALYSIS_START_REQUIRED",
            "acknowledged original start required",
          )
        assertMatchingSurveyOwner(original, body)
        assertMatchingSurveyOwner(originalConsent, body)
        if (body.endedAtMs < original.startedAtMs)
          throwApiError(
            409,
            "ANALYSIS_EVENT_CONFLICT",
            "terminal precedes start",
          )
        if (original.outcomeReceivedAt) {
          if (
            original.outcome !== body.outcome ||
            original.endedAtMs !== body.endedAtMs
          )
            throwApiError(
              409,
              "ANALYSIS_EVENT_CONFLICT",
              "terminal observation conflicts",
            )
          return
        }
        if (original.outcome !== "started")
          throwApiError(
            409,
            "ANALYSIS_EVENT_CONFLICT",
            "original terminal evidence incomplete",
          )
        const observation = {
          ...projectAnalysisRun(original),
          outcome: body.outcome,
          endedAtMs: body.endedAtMs,
          outcomeReceivedAt: FieldValue.serverTimestamp(),
        }
        writeAnalysisRun(tx, body.analysisId, observation)
        writeAccessEvent(tx, "analysis_terminal", observation)
        return
      }
    }
    assertActiveParticipation(state)
    const consent = await assertCurrentConsent(tx, state, body)
    const audit = {
      // Audit-only delivery may already have accepted the terminal outcome
      // while the research attempt still contains only its start.
      ...projectAnalysisRun(run ?? existing ?? {}),
      pseudonym: body.pseudonym,
      consentId: body.consentId,
      clientId: body.clientId,
      serverId: body.serverId,
      analysisId: body.analysisId,
      dataPurpose: consent.dataPurpose,
      consentBoundaryId: consent.precedingWithdrawalId,
      studyGeneration: state.data.studyGeneration ?? null,
    }
    const study = readStudyParticipation(state)
    if (body.outcome === "unavailable") {
      if (!existing)
        throwApiError(409, "ANALYSIS_START_REQUIRED", "analysis start required")
      assertMatchingSurveyOwner(existing, body)
      const questionnaireRef = getParticipantRepository().analysisQuestionnaire(
        body.analysisId,
      )
      const questionnaire = (await tx.get(questionnaireRef)).data()
      if (questionnaire) assertMatchingSurveyOwner(questionnaire, body)
      if (
        existing.questionnaireKind !== "follow-up" &&
        !questionnaire?.submittedAt &&
        (existing.presentationRecordedAt ||
          questionnaire?.presentationRecordedAt)
      )
        throwApiError(
          409,
          "RESULT_ALREADY_PRESENTED",
          "presented output cannot be recovered",
        )
      if (existing.resultUnavailableAt) return
      assertStudyAnalysis(study, body)
      if (existing.outcome !== "started" && existing.outcome !== "completed")
        throwApiError(
          409,
          "ANALYSIS_EVENT_CONFLICT",
          "output loss requires an unfinished or completed attempt",
        )
      const loss = {
        ...audit,
        resultUnavailableAt: FieldValue.serverTimestamp(),
      }
      writeAnalysisRun(tx, body.analysisId, loss)
      writeAccessEvent(tx, "analysis_unavailable", loss)
      tx.update(ref, {
        resultUnavailableAt: FieldValue.serverTimestamp(),
        unavailability: body,
      })
      if (questionnaire)
        tx.update(questionnaireRef, {
          resultUnavailableAt: FieldValue.serverTimestamp(),
        })
      if (
        study.kind === "initial" &&
        study.initial?.analysisId === body.analysisId
      )
        tx.set(state.ref, { initialAnalysis: null }, { merge: true })
      return
    }
    if (body.outcome === "presented") {
      if (existing?.resultUnavailableAt)
        throwApiError(
          409,
          "RESULT_UNAVAILABLE",
          "recovered output cannot be presented",
        )
      assertStudyAnalysis(study, body)
      if (existing?.outcome !== "completed")
        throwApiError(
          409,
          "ANALYSIS_COMPLETION_NOT_FOUND",
          "completed analysis required",
        )
      assertMatchingSurveyOwner(existing, body)
      const questionnaireRef = getParticipantRepository().analysisQuestionnaire(
        body.analysisId,
      )
      const questionnaire = (await tx.get(questionnaireRef)).data()
      if (!questionnaire)
        throwApiError(
          409,
          "ANALYSIS_COMPLETION_NOT_FOUND",
          "completion metadata required",
        )
      assertMatchingSurveyOwner(questionnaire, body)
      if (existing.presentationRecordedAt) return
      const presentation = {
        ...audit,
        presentationRecordedAt: FieldValue.serverTimestamp(),
      }
      writeAnalysisRun(tx, body.analysisId, presentation)
      writeAccessEvent(tx, "analysis_presented", presentation)
      tx.update(ref, { presentationRecordedAt: FieldValue.serverTimestamp() })
      tx.update(questionnaireRef, {
        presentationRecordedAt: FieldValue.serverTimestamp(),
      })
      if (study.kind === "initial")
        tx.set(
          state.ref,
          {
            studyStatus: "initial-pending",
            initialAnalysis: {
              analysisId: body.analysisId,
              clientId: body.clientId,
              serverId: body.serverId,
              consentId: body.consentId,
              presented: true,
            },
          },
          { merge: true },
        )
      return
    }
    if (
      existing?.resultUnavailableAt !== undefined &&
      body.outcome === "started"
    )
      throwApiError(409, "RESULT_UNAVAILABLE", "recovered attempt cannot start")
    if (existing) {
      assertMatchingSurveyOwner(existing, body)
      const recorded =
        body.outcome === "started" ? existing.start : existing.end
      if (recorded) {
        if (
          body.outcome === "started" &&
          existing.questionnaireKind !== "initial" &&
          existing.questionnaireKind !== "follow-up"
        )
          throwApiError(409, "ANALYSIS_EVENT_CONFLICT", "analysis kind missing")
        const expected =
          body.outcome === "started"
            ? { ...body, questionnaireKind: existing.questionnaireKind }
            : body
        if (
          serializeCanonicalJson(recorded) !== serializeCanonicalJson(expected)
        )
          throwApiError(
            409,
            "ANALYSIS_EVENT_CONFLICT",
            "analysis event conflicts",
          )
        return body.outcome === "started"
          ? {
              questionnaireKind: existing.questionnaireKind as
                | "initial"
                | "follow-up",
            }
          : undefined
      }
    }
    if (!existing?.resultUnavailableAt) assertStudyAnalysis(study, body)
    if (body.outcome === "started") {
      // Research deletion does not release the ID of its retained audit history.
      if (run !== undefined)
        throwApiError(
          409,
          "ANALYSIS_EVENT_CONFLICT",
          "analysis ID already retained",
        )
      const start = { ...body, questionnaireKind: study.kind }
      tx.set(
        state.ref,
        {
          pseudonym: body.pseudonym,
          status: "active",
          studyStatus:
            study.kind === "initial" ? "initial-pending" : "follow-up",
          ...(study.kind === "initial"
            ? {
                initialAnalysis: {
                  analysisId: body.analysisId,
                  clientId: body.clientId,
                  serverId: body.serverId,
                  consentId: body.consentId,
                  presented: false,
                },
              }
            : {}),
        },
        { merge: true },
      )
      const started = {
        ...audit,
        questionnaireKind: study.kind,
        outcome: "started",
        startedAtMs: body.startedAtMs,
        receivedAt: FieldValue.serverTimestamp(),
      }
      writeAnalysisRun(tx, body.analysisId, started)
      writeAccessEvent(tx, "analysis_started", started)
      tx.create(ref, {
        ...start,
        consentBoundaryId: consent.precedingWithdrawalId,
        studyGeneration: state.data.studyGeneration ?? null,
        dataPurpose: consent.dataPurpose,
        start,
        receivedAt: FieldValue.serverTimestamp(),
      })
      return { questionnaireKind: study.kind }
    }
    if (!existing || body.endedAtMs < existing.startedAtMs)
      throwApiError(409, "ANALYSIS_START_REQUIRED", "analysis start required")
    if (
      study.kind === "initial" &&
      body.outcome !== "completed" &&
      study.initial?.analysisId === body.analysisId &&
      study.initial.presented !== true
    )
      tx.set(state.ref, { initialAnalysis: null }, { merge: true })
    const ended = {
      ...audit,
      outcome: body.outcome,
      endedAtMs: body.endedAtMs,
      outcomeReceivedAt: run?.outcomeReceivedAt ?? FieldValue.serverTimestamp(),
    }
    writeAnalysisRun(tx, body.analysisId, ended)
    if (!run?.outcomeReceivedAt)
      writeAccessEvent(tx, "analysis_terminal", ended)
    tx.update(ref, {
      outcome: body.outcome,
      end: body,
      endedAtMs: body.endedAtMs,
      durationMs: body.durationMs,
      outcomeReceivedAt: ended.outcomeReceivedAt,
    })
  })
}
