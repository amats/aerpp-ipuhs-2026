import { ANALYSIS_RUN_FIELDS } from "@aerpp/firestore/participant-snapshot-types"
import type {
  ResearchSource,
  SourceDocument,
} from "../src/features/research/research-types"

export const SNAPSHOT = "2026-01-05T12:00:00.000Z"
export function fixtureSource(): ResearchSource {
  return {
    analysisQuestionnaires: [],
    attempts: [],
    participationEvents: [],
    participationStates: [],
    snapshotAt: SNAPSHOT,
  }
}
export function addPerson(
  source: ResearchSource,
  person: string,
  renewed = false,
) {
  source.participationEvents.push({
    id: `consent-${person}`,
    data: {
      dataPurpose: "research",
      pseudonym: person,
      consentId: `consent-${person}`,
      clientId: `client-${person}`,
      serverId: "server-a",
      eventType: "consent",
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      consentConfirmedAt: "2026-01-01T00:00:00.000Z",
      precedingWithdrawalId: renewed ? "withdrawal-old" : null,
    },
  })
  source.participationStates.push({
    id: `state-${person}`,
    data: {
      dataPurpose: "research",
      pseudonym: person,
      status: "active",
      consentBoundaryId: renewed ? "withdrawal-old" : null,
    },
  })
}
export function addAnalysis(
  source: ResearchSource,
  person: string,
  id: string,
  answers: Record<string, unknown> = {},
  followup = false,
): SourceDocument {
  const owner = {
    pseudonym: person,
    consentId: `consent-${person}`,
    clientId: `client-${person}`,
    serverId: "server-a",
    analysisId: id,
  }
  const startedAtMs = Date.parse(
    followup ? "2026-01-03T00:00:00.000Z" : "2026-01-02T00:00:00.000Z",
  )
  source.attempts.push({
    id,
    data: {
      dataPurpose: "research",
      ...owner,
      startedAtMs,
      endedAtMs: startedAtMs + 5000,
      durationMs: 5000,
      outcome: "completed",
      questionnaireKind: followup ? "follow-up" : "initial",
      documentGraphemeCounts: [4, 7],
    },
  })
  const record = {
    id,
    data: {
      dataPurpose: "research",
      ...owner,
      submittedAt: new Date(startedAtMs + 10000).toISOString(),
      createdAt: new Date(startedAtMs + 6000).toISOString(),
      analysisWorkspaceVersion: "1.0.0",
      _integrity: { version: 1 },
      resultGraphemeCount: 5,
      ...answers,
    },
  }
  source.analysisQuestionnaires.push(record)
  const operational: Record<string, unknown> = {
    ...source.attempts.at(-1)?.data,
    ...record.data,
  }
  source.analysisRuns ??= []
  source.analysisRuns.push({
    id,
    data: Object.fromEntries(
      ANALYSIS_RUN_FIELDS.filter((key) => Object.hasOwn(operational, key)).map(
        (key) => [key, operational[key]],
      ),
    ),
  })
  return record
}
