import type { RecordAnalysisOutcomeRequestSchema } from "@aerpp/participant-api-contracts/participant-api"
import type { z } from "zod"
import { throwApiError } from "./api-errors.js"
import {
  projectAnalysisRun,
  writeAccessEvent,
  writeAnalysisRun,
} from "./participant-audit.js"
import { readParticipationState } from "./participant-state.js"
import {
  FieldValue,
  getFirestore,
  getParticipantRepository,
  Timestamp,
} from "./storage.js"
import { assertMatchingSurveyOwner } from "./survey-payload.js"

// Redelivery preserves operational evidence even after withdrawal or recovery.
// It never reconstructs research, changes eligibility or releases an active claim.
export async function recordAnalysisOutcomeData(
  body: z.infer<typeof RecordAnalysisOutcomeRequestSchema>,
) {
  await getFirestore().runTransaction(async (tx) => {
    await readParticipationState(tx, body.pseudonym)
    const repository = getParticipantRepository()
    const [runSnapshot, consentSnapshot] = await Promise.all([
      tx.get(repository.analysisRun(body.analysisId)),
      tx.get(repository.participationEvent(body.consentId)),
    ])
    const run = runSnapshot.data()
    const consent = consentSnapshot.data()
    if (
      !run ||
      consent?.eventType !== "consent" ||
      consent.authenticationVersion !== 2 ||
      !(run.receivedAt instanceof Timestamp) ||
      typeof run.startedAtMs !== "number" ||
      !Number.isFinite(run.startedAtMs) ||
      (run.studyGeneration ?? null) !== (consent.studyGeneration ?? null) ||
      (run.consentBoundaryId ?? null) !==
        (consent.precedingWithdrawalId ?? null)
    )
      throwApiError(
        409,
        "ANALYSIS_START_REQUIRED",
        "acknowledged original start required",
      )
    assertMatchingSurveyOwner(run, body)
    assertMatchingSurveyOwner(consent, body)
    if (body.endedAtMs < run.startedAtMs)
      throwApiError(409, "ANALYSIS_EVENT_CONFLICT", "terminal precedes start")
    if (run.outcomeReceivedAt) {
      if (run.outcome !== body.outcome || run.endedAtMs !== body.endedAtMs)
        throwApiError(
          409,
          "ANALYSIS_EVENT_CONFLICT",
          "terminal observation conflicts",
        )
      return
    }
    if (run.outcome !== "started")
      throwApiError(
        409,
        "ANALYSIS_EVENT_CONFLICT",
        "original terminal evidence incomplete",
      )
    const observation = {
      ...projectAnalysisRun(run),
      outcome: body.outcome,
      endedAtMs: body.endedAtMs,
      outcomeReceivedAt: FieldValue.serverTimestamp(),
    }
    writeAnalysisRun(tx, body.analysisId, observation)
    writeAccessEvent(tx, "analysis_terminal", observation)
  })
}
