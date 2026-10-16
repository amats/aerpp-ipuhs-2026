import { createHash } from "node:crypto"
import type { Firestore } from "@google-cloud/firestore"

// Return references and queries so callers can include reads in their own transaction.
// This repository does not authorize writes or start independent write transactions.
export function createParticipantRepository(database: Firestore) {
  const participationEvents = () => database.collection("participationEvents")
  const analysisQuestionnaires = () =>
    database.collection("analysisQuestionnaires")
  const analysisAttempts = () => database.collection("analysisAttempts")
  const participationStates = () => database.collection("participationStates")
  const analysisRuns = () => database.collection("analysisRuns")
  const accessEvents = () => database.collection("accessEvents")
  const withdrawalJobs = () => database.collection("withdrawalJobs")
  const participationEventsFor = (pseudonym: string) =>
    participationEvents().where("pseudonym", "==", pseudonym)
  const analysisQuestionnairesFor = (pseudonym: string) =>
    analysisQuestionnaires().where("pseudonym", "==", pseudonym)
  return {
    participationEvents,
    analysisQuestionnaires,
    analysisAttempts,
    participationStates,
    analysisRuns,
    accessEvents,
    withdrawalJobs,
    analysisRunsFor: (pseudonym: string) =>
      analysisRuns().where("pseudonym", "==", pseudonym),
    accessEventsFor: (pseudonym: string) =>
      accessEvents().where("pseudonym", "==", pseudonym),
    withdrawalJobsFor: (pseudonym: string) =>
      withdrawalJobs().where("pseudonym", "==", pseudonym),
    analysisRun: (analysisId: string) => analysisRuns().doc(analysisId),
    accessEvent: (id: string) => accessEvents().doc(id),
    withdrawalJob: (id: string) => withdrawalJobs().doc(id),
    participationEventsFor,
    analysisQuestionnairesFor,
    analysisAttemptsFor: (pseudonym: string) =>
      analysisAttempts().where("pseudonym", "==", pseudonym),
    participationEvent: (id?: string) =>
      id === undefined
        ? participationEvents().doc()
        : participationEvents().doc(id),
    analysisQuestionnaire: (analysisId: string) =>
      analysisQuestionnaires().doc(analysisId),
    analysisAttempt: (analysisId: string) => analysisAttempts().doc(analysisId),
    participationState: (pseudonym: string) =>
      participationStates().doc(participationStateId(pseudonym)),
  }
}

export function participationStateId(pseudonym: string): string {
  return createHash("sha256").update(pseudonym).digest("hex")
}
