import type { DocumentData } from "@google-cloud/firestore"
import { projectAnalysisRun, writeAnalysisRun } from "./participant-audit.js"
import { FieldValue, type Transaction } from "./storage.js"

// Preserve the operational projection atomically with research deletion.
// Never copy nested start/end requests, answers, model details or measurements.
export function retainWithdrawalActivity(
  tx: Transaction,
  analysisId: string,
  data: DocumentData,
  withdrawalId?: string,
  source: "questionnaire" | "attempt" = "questionnaire",
  retained: DocumentData = {},
) {
  const projection = projectAnalysisRun(data)
  if (source === "questionnaire") {
    for (const key of [
      "outcome",
      "startedAtMs",
      "endedAtMs",
      "receivedAt",
      "outcomeReceivedAt",
      "questionnaireKind",
    ])
      delete projection[key]
  }
  for (const key of Object.keys(retained)) delete projection[key]
  writeAnalysisRun(tx, analysisId, {
    ...projection,
    ...(withdrawalId ? { researchWithdrawalId: withdrawalId } : {}),
    [source === "attempt" ? "attemptDeletedAt" : "questionnaireDeletedAt"]:
      FieldValue.serverTimestamp(),
  })
}
