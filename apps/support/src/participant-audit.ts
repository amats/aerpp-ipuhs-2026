import { createHash } from "node:crypto"
import { ANALYSIS_RUN_FIELDS } from "@aerpp/firestore/participant-snapshot-types"
import type { DocumentData } from "@google-cloud/firestore"
import {
  FieldValue,
  getParticipantRepository,
  type Transaction,
} from "./storage.js"

// This projection is operational history, never a second research payload.
// Keep original ownership distinct from the owner of a recovered submission.
export function projectAnalysisRun(data: DocumentData): DocumentData {
  const result: DocumentData = Object.fromEntries(
    ANALYSIS_RUN_FIELDS.filter(
      (key) => key !== "recoverySubmission" && Object.hasOwn(data, key),
    ).map((key) => [key, data[key]]),
  )
  if (data.recoverySubmission) {
    result.recoverySubmission = Object.fromEntries(
      ["recoveryId", "consentId", "clientId", "serverId", "studyGeneration"]
        .filter((key) => Object.hasOwn(data.recoverySubmission, key))
        .map((key) => [key, data.recoverySubmission[key]]),
    )
  }
  return result
}

export function writeAnalysisRun(
  tx: Transaction,
  analysisId: string,
  data: DocumentData,
) {
  tx.set(
    getParticipantRepository().analysisRun(analysisId),
    {
      ...projectAnalysisRun(data),
      analysisId,
      schemaVersion: 1,
    },
    { merge: true },
  )
}

export function auditEventId(eventType: string, data: DocumentData) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        eventType,
        data.pseudonym,
        data.consentId ?? null,
        data.analysisId ?? null,
        data.recoveryId ?? null,
        data.withdrawalId ?? null,
      ]),
    )
    .digest("hex")
}

// Call only for a newly accepted transition, inside its owning transaction.
export function writeAccessEvent(
  tx: Transaction,
  eventType: string,
  data: DocumentData,
) {
  const projection = projectAnalysisRun(data)
  for (const key of [
    "recoveryId",
    "withdrawalId",
    "reasonCode",
    "precedingWithdrawalId",
    "expiresAt",
  ])
    if (Object.hasOwn(data, key)) projection[key] = data[key]
  tx.create(
    getParticipantRepository().accessEvent(auditEventId(eventType, data)),
    {
      ...projection,
      schemaVersion: 1,
      eventType,
      recordedAt: FieldValue.serverTimestamp(),
    },
  )
}
