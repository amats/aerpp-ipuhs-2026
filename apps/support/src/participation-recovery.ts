import { ParticipationRecoverySchema } from "@aerpp/participant-api-contracts/participant-api"
import { throwApiError } from "./api-errors.js"
import { getParticipantRepository, type Transaction } from "./storage.js"
import {
  assertMatchingSurveyOwner,
  serializeCanonicalJson,
} from "./survey-payload.js"

export async function assertRecoveryRecord(
  tx: Transaction,
  grant: Record<string, unknown>,
  pseudonym: string,
) {
  const stored = (
    await tx.get(
      getParticipantRepository().participationEvent(String(grant.recoveryId)),
    )
  ).data()
  const fields = [
    "recoveryId",
    "destination",
    "analysisId",
    "sourceOwner",
    "expectedStudyGeneration",
    "precedingWithdrawalId",
    "actorId",
    "reason",
    "usedConsentId",
  ]
  const decision = (value: Record<string, unknown>) =>
    Object.fromEntries(
      fields
        .filter((key) => Object.hasOwn(value, key))
        .map((key) => [key, value[key]]),
    )
  if (
    stored?.eventType !== "recovery_authorized" ||
    stored.pseudonym !== pseudonym ||
    stored.supersededBy ||
    serializeCanonicalJson(decision(stored)) !==
      serializeCanonicalJson(decision(grant))
  )
    throwApiError(
      409,
      "RECOVERY_INVALID",
      "recovery record no longer matches state",
    )
}

export function readRecovery(value: Record<string, unknown> | undefined) {
  if (!value) return undefined
  const parsed = ParticipationRecoverySchema.safeParse(value)
  if (
    parsed.success !== true ||
    (parsed.data.destination === "initial-survey" && !parsed.data.analysisId)
  )
    throwApiError(409, "RECOVERY_INVALID", "recovery authorization invalid")
  return parsed.data
}

export function assertRecoveryBoundary(
  grant: Record<string, unknown>,
  state: Record<string, unknown>,
) {
  if (
    grant.expectedStudyGeneration !== (state.studyGeneration ?? null) ||
    grant.precedingWithdrawalId !== (state.lastWithdrawalId ?? null)
  )
    throwApiError(
      409,
      "CONSENT_SUPERSEDED",
      "recovery authorization no longer current",
    )
}

export async function validateRecoveryTarget(
  tx: Transaction,
  grant: Record<string, unknown>,
  pseudonym: string,
) {
  const recovery = readRecovery(grant)
  if (recovery?.destination !== "initial-survey") return
  if (!recovery.analysisId)
    throwApiError(409, "RECOVERY_INVALID", "recovery target required")
  const repository = getParticipantRepository()
  const metadata = (
    await tx.get(repository.analysisQuestionnaire(recovery.analysisId))
  ).data()
  const attempt = (
    await tx.get(repository.analysisAttempt(recovery.analysisId))
  ).data()
  if (
    !metadata ||
    metadata.pseudonym !== pseudonym ||
    metadata.analysisId !== recovery.analysisId ||
    !metadata._integrity?.metadata ||
    metadata.submittedAt ||
    attempt?.pseudonym !== pseudonym ||
    attempt.outcome !== "completed" ||
    attempt.questionnaireKind !== "initial"
  )
    throwApiError(
      409,
      "RECOVERY_TARGET_UNAVAILABLE",
      "initial survey target unavailable",
    )
  assertMatchingSurveyOwner(metadata, grant.sourceOwner)
  assertMatchingSurveyOwner(attempt, grant.sourceOwner)
}
