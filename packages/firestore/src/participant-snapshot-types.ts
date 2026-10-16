export type ParticipantSourceDocument = {
  id: string
  data: Record<string, unknown>
}
export type ParticipantResearchSnapshot = {
  analysisQuestionnaires: ParticipantSourceDocument[]
  attempts: ParticipantSourceDocument[]
  participationEvents: ParticipantSourceDocument[]
  participationStates: ParticipantSourceDocument[]
  emailConfirmations?: ParticipantSourceDocument[]
  analysisRuns?: ParticipantSourceDocument[]
  accessEvents?: ParticipantSourceDocument[]
  withdrawalJobs?: ParticipantSourceDocument[]
  snapshotAt: string
}

// Explicit operational projections shared by reads and writes. No research
// measurements, contact ciphertext or credential material belongs here.
export const ANALYSIS_RUN_FIELDS = [
  "schemaVersion",
  "pseudonym",
  "consentId",
  "clientId",
  "serverId",
  "analysisId",
  "dataPurpose",
  "questionnaireKind",
  "consentBoundaryId",
  "studyGeneration",
  "startedAtMs",
  "endedAtMs",
  "receivedAt",
  "outcomeReceivedAt",
  "outcome",
  "createdAt",
  "presentationRecordedAt",
  "submittedAt",
  "resultUnavailableAt",
  "researchDeletedAt",
  "researchWithdrawalId",
  "attemptDeletedAt",
  "questionnaireDeletedAt",
  "recoverySubmission",
] as const
export const ACCESS_EVENT_FIELDS = [
  ...ANALYSIS_RUN_FIELDS,
  "eventType",
  "recordedAt",
  "recoveryId",
  "withdrawalId",
  "reasonCode",
  "actorId",
  "recordId",
  "documentSet",
  "precedingWithdrawalId",
  "expiresAt",
] as const
export const WITHDRAWAL_JOB_FIELDS = [
  "schemaVersion",
  "pseudonym",
  "withdrawalId",
  "consentBoundaryId",
  "acceptedAt",
  "status",
  "deletedCount",
  "updatedAt",
  "completedAt",
] as const
