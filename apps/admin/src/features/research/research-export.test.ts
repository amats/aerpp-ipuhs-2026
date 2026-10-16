import {
  createQuestionnaireArtifact,
  questionnaireObjectName,
} from "@aerpp/config/questionnaire"
import {
  PRIVATE_PARTICIPANT_FIELD_NAMES,
  SurveyAnswerFieldNameSchema,
} from "@aerpp/participant-api-contracts/participant-api"
import followup from "@aerpp-surveys/survey-follow-up.json"
import initial from "@aerpp-surveys/survey-initial.json"
import { expect, it, vi } from "vitest"
import { readArchive } from "../../../test-support/read-archive"
import {
  addAnalysis,
  addPerson,
  fixtureSource,
} from "../../../test-support/research-fixtures"
import { exportArchive } from "./export-archive"
import {
  accessFiles,
  buildAccessExport,
  buildRawExport,
  questionnaireRows,
  researchFiles,
  sourceRows,
  toCsv,
} from "./research-export"
import type { QuestionDefinition } from "./research-types"

function syntheticArchives(definitions: Record<string, QuestionDefinition>) {
  return Object.fromEntries(
    Object.values(definitions).map((definition) => {
      const artifact = createQuestionnaireArtifact(JSON.stringify(definition))
      return [questionnaireObjectName(artifact.definitionId), artifact.json]
    }),
  )
}

it.each(PRIVATE_PARTICIPANT_FIELD_NAMES)(
  "reserves private export field %s so it cannot silently discard a questionnaire answer",
  (field) => {
    expect(SurveyAnswerFieldNameSchema.safeParse(field).success).toBe(false)
    const source = fixtureSource()
    source.analysisQuestionnaires = [
      {
        id: "synthetic-analysis",
        data: {
          custom_question: "Synthetic answer",
          [field]: "Synthetic private value",
          nested: [
            {
              [field]: "Nested private value",
              custom_question: "Nested answer",
            },
          ],
        },
      },
    ]
    const exported = buildRawExport(source, { initial, followup })
    expect(exported.analysisQuestionnaires[0].data).toEqual({
      custom_question: "Synthetic answer",
      nested: [{ custom_question: "Nested answer" }],
    })
    expect(exported.manifest.counts.analysisQuestionnaires).toEqual({
      read: 1,
      exported: 1,
    })
  },
)

it.each([true, false])(
  "exports the actual answer labels and reverse=%s in the questionnaire dictionary",
  (reverse) => {
    const definition = {
      description: "Synthetic definition",
      survey_version: "synthetic-v1",
      types: [{ type: "likert7", labels: { "1": "Disagree", "7": "Agree" } }],
      items: [
        {
          item_id: "Q1",
          type: "likert7",
          question_ja: "Synthetic rating",
          construct: "PE",
          reverse,
          required: false,
        },
        {
          item_id: "Q2",
          question_ja: "Synthetic choice",
          type: "single_choice",
          options: ["Yes", "No"],
          construct: "CTX",
          required: true,
        },
      ],
    }
    const artifact = createQuestionnaireArtifact(JSON.stringify(definition))
    const definitions = { [artifact.definitionId]: artifact.definition }
    const rows = questionnaireRows(definitions)
    expect(rows[0]).toMatchObject({
      options: ["Disagree", "Agree"],
      valueLabels: { "1": "Disagree", "7": "Agree" },
      construct: "PE",
      reverse,
    })
    expect(rows[1]).toMatchObject({ options: ["Yes", "No"], construct: "CTX" })
    expect(rows[1].reverse).toBeUndefined()
    const source = fixtureSource()
    source.analysisQuestionnaires = [{ id: "analysis", data: { Q1: "Agree" } }]
    const exported = buildRawExport(source, definitions)
    expect(exported.manifest.schemaVersion).toBe(6)
    const path = questionnaireObjectName(artifact.definitionId)
    const originals = { [path]: artifact.json }
    const files = researchFiles(exported, originals)
    expect(files["questionnaires.csv"]).toContain('"[""Disagree"",""Agree""]"')
    expect(exported.questionnaires[artifact.definitionId]).toEqual(definition)
    const archive = readArchive(exportArchive(files))
    expect(archive[path]).toBe(artifact.json)
    expect(rows[0].definitionId).toBe(artifact.definitionId)
    expect(exported.analysisQuestionnaires).toEqual(
      source.analysisQuestionnaires,
    )
  },
)

it("exports every eligible retained record across purpose, server, date, submission and version", () => {
  const source = fixtureSource()
  for (let i = 0; i < 1001; i++) {
    const person = `person-${i}`
    addPerson(source, person, i % 2 === 0)
    addAnalysis(source, person, `a-${i}`, {
      PE1: i % 2 ? true : null,
      customMetadata: "arbitrary",
      TX1: "original text",
      processingDurationSeconds: 9,
      dataPurpose: ["research", "test", undefined, "invalid"][i % 4],
      serverId: `server-${i % 3}`,
      submittedAt: i % 2 ? null : "2000-01-01T00:00:00Z",
    })
  }
  const result = buildRawExport(source, { initial, followup })
  expect(result.analysisQuestionnaires).toHaveLength(1001)
  expect(result.attempts).toHaveLength(1001)
  expect(result.manifest.counts.analysisQuestionnaires).toEqual({
    read: 1001,
    exported: 1001,
  })
  expect(result.manifest.excludedRecords).toBe(0)
  expect(result.analysisQuestionnaires[0].data).toMatchObject({
    PE1: null,
    customMetadata: "arbitrary",
    TX1: "original text",
    processingDurationSeconds: 9,
  })
  expect(result.analysisQuestionnaires[1].data.PE1).toBe(true)
  expect(result.analysisQuestionnaires[0].data).not.toHaveProperty("PE2")
})

it("preserves analysis workspace versions in research JSON and CSV without copying them to access exports", async () => {
  const source = { ...fixtureSource(), emailConfirmations: [] }
  addPerson(source, "participant")
  for (const [index, analysisWorkspaceVersion] of ["1.0.0", "1.0.1"].entries())
    addAnalysis(source, "participant", `analysis-${index}`, {
      analysisWorkspaceVersion,
      _integrity: { metadata: { analysisWorkspaceVersion } },
    })
  const research = buildRawExport(source, {})
  const files = researchFiles(research, {})
  expect(
    JSON.parse(files["source.json"]).analysisQuestionnaires.map(
      ({ data }: { data: Record<string, unknown> }) =>
        data.analysisWorkspaceVersion,
    ),
  ).toEqual(["1.0.0", "1.0.1"])
  expect(files["analysis-questionnaires.csv"]).toContain(
    '"analysisWorkspaceVersion"',
  )
  for (const version of ["1.0.0", "1.0.1"])
    expect(files["analysis-questionnaires.csv"]).toContain(`"${version}"`)
  expect(research.analysisQuestionnaires[0].data._integrity).toEqual({
    metadata: { analysisWorkspaceVersion: "1.0.0" },
  })
  const access = await buildAccessExport(source, vi.fn(), "synthetic-key")
  expect(JSON.stringify(accessFiles(access))).not.toContain(
    "analysisWorkspaceVersion",
  )
})

it("separates contacts and event metadata from research answers, including nested contact fields", async () => {
  const source = fixtureSource()
  addPerson(source, "a")
  addAnalysis(source, "a", "a", {
    TX1: "answer-body",
    encryptedEmail: "ciphertext",
    nested: { email: "synthetic@example.invalid", PE1: null },
  })
  source.participationEvents[0].data.encryptedEmail = "ciphertext"
  source.participationEvents[0].data.tokenHash = "secret-verifier"
  source.emailConfirmations = [
    {
      id: "pending",
      data: {
        encryptedEmail: "pending-ciphertext",
        status: "sent",
        createdAt: { seconds: 1, nanoseconds: 123 },
        tokenNonce: "secret-nonce",
      },
    },
  ]
  const research = buildRawExport(source, { initial, followup })
  const decryptEmail = vi.fn(async () => "synthetic@example.invalid")
  const access = await buildAccessExport(
    source,
    decryptEmail,
    "synthetic-identifier-secret",
  )
  expect(JSON.stringify(research)).not.toContain("ciphertext")
  expect(JSON.stringify(research)).not.toContain("synthetic@example.invalid")
  expect(research.analysisQuestionnaires[0].data.nested).toEqual({ PE1: null })
  expect(research.analysisQuestionnaires[0].data.TX1).toBe("answer-body")
  expect(access.participationEvents[0].data.email).toBe(
    "synthetic@example.invalid",
  )
  expect(access.emailConfirmations[0].data.email).toBe(
    "synthetic@example.invalid",
  )
  expect(access.participationEvents[0].data).not.toHaveProperty(
    "encryptedEmail",
  )
  expect(access.emailConfirmations[0].data).not.toHaveProperty("encryptedEmail")
  expect(decryptEmail).toHaveBeenNthCalledWith(1, "ciphertext")
  expect(decryptEmail).toHaveBeenNthCalledWith(2, "pending-ciphertext")
  expect(source.participationEvents[0].data.encryptedEmail).toBe("ciphertext")
  expect(access.emailConfirmations[0].data.status).toBe("sent")
  expect(access.analysisAccess[0].data).toMatchObject({
    outcome: "completed",
  })
  expect(access.surveyAccess[0].data.submittedAt).toBe(
    source.analysisQuestionnaires[0].data.submittedAt,
  )
  expect(JSON.stringify(access)).not.toContain("answer-body")
  expect(JSON.stringify(access)).not.toContain("secret-verifier")
  expect(JSON.stringify(access)).not.toContain("secret-nonce")
  expect(access.manifest.exportId).not.toBe(research.manifest.exportId)
  expect(access.manifest.snapshotAt).toBe(research.manifest.snapshotAt)
  expect(access.manifest.counts.emailConfirmations).toEqual({
    read: 1,
    exported: 1,
  })
  expect(
    readArchive(exportArchive(accessFiles(access)))["participation-events.csv"],
  ).toContain("synthetic@example.invalid")
  expect(
    readArchive(
      exportArchive(
        researchFiles(research, syntheticArchives(research.questionnaires)),
      ),
    )["analysis-questionnaires.csv"],
  ).toContain("answer-body")
})

it("rejects missing access reads rather than reporting an empty authentication collection", async () => {
  await expect(
    buildAccessExport(fixtureSource(), vi.fn(), "synthetic-identifier-secret"),
  ).rejects.toThrow("Access snapshot required")
})

it("preserves absent, null and empty email values without inventing addresses", async () => {
  const source = fixtureSource()
  for (const person of ["missing", "null", "empty"]) addPerson(source, person)
  source.participationEvents[1].data.encryptedEmail = null
  source.participationEvents[2].data.encryptedEmail = ""
  source.emailConfirmations = structuredClone(source.participationEvents)
  const decryptEmail = vi.fn()
  const access = await buildAccessExport(
    source,
    decryptEmail,
    "synthetic-identifier-secret",
  )
  for (const rows of [access.participationEvents, access.emailConfirmations]) {
    expect(rows[0].data).not.toHaveProperty("email")
    expect(rows[1].data.email).toBeNull()
    expect(rows[2].data.email).toBe("")
  }
  expect(decryptEmail).not.toHaveBeenCalled()
  expect(JSON.stringify(access)).not.toContain("encryptedEmail")
})

it.each([42, {}, ["ciphertext"]])(
  "marks invalid stored email types without dropping records: %j",
  async (value) => {
    const source = fixtureSource()
    addPerson(source, "invalid")
    source.participationEvents[0].data.encryptedEmail = value
    source.emailConfirmations = [
      { id: "invalid", data: { encryptedEmail: value } },
    ]
    const decryptEmail = vi.fn()
    const access = await buildAccessExport(
      source,
      decryptEmail,
      "synthetic-identifier-secret",
    )
    expect(access.participationEvents[0].data).toMatchObject({
      email: "復号できません",
      did: null,
    })
    expect(access.emailConfirmations[0].data.email).toBe("復号できません")
    expect(decryptEmail).not.toHaveBeenCalled()
    expect(JSON.stringify(access)).not.toContain("encryptedEmail")
  },
)

it("exports explicit event timestamps without inventing missing request times", async () => {
  const source = fixtureSource()
  addPerson(source, "current")
  addPerson(source, "legacy")
  source.emailConfirmations = []
  source.participationEvents[0].data.consentRequestedAt = {
    seconds: 1700000000,
    nanoseconds: 123456789,
  }
  source.participationEvents[0].data.consentConfirmedAt = {
    seconds: 1700000060,
    nanoseconds: 0,
  }
  const access = await buildAccessExport(
    source,
    vi.fn(),
    "synthetic-identifier-secret",
  )
  expect(access.participationEvents[0].data).toMatchObject({
    consentRequestedAt: { seconds: 1700000000, nanoseconds: 123456789 },
    consentConfirmedAt: { seconds: 1700000060, nanoseconds: 0 },
  })
  expect(access.participationEvents[1].data).not.toHaveProperty(
    "consentRequestedAt",
  )
  expect(
    access.participationEvents.every(
      (record) => !Object.hasOwn(record.data, "createdAt"),
    ),
  ).toBe(true)
  const csv = accessFiles(access)["participation-events.csv"]
  expect(csv).toContain("consentRequestedAtUtc")
  expect(csv).toContain("consentConfirmedAtUtc")
  expect(csv).not.toContain("createdAtUtc")
  expect(csv).toContain("2023-11-14T22:13:20.123Z")
  expect(csv).toContain("2023-11-14T22:14:20.000Z")
})

it.each([true, false, null, undefined])(
  "preserves withdrawal completion evidence without inventing missing values: %s",
  async (completed) => {
    const source = fixtureSource()
    addPerson(source, "withdrawn")
    source.emailConfirmations = []
    if (completed !== undefined) {
      source.participationEvents[0].data.hasCompletedAnalysis = completed
      source.participationStates[0].data.hasCompletedAnalysis = completed
    }
    const access = await buildAccessExport(
      source,
      vi.fn(),
      "synthetic-identifier-secret",
    )
    for (const record of [
      access.participationEvents[0],
      access.participationStates[0],
    ]) {
      if (completed === undefined)
        expect(record.data).not.toHaveProperty("hasCompletedAnalysis")
      else expect(record.data.hasCompletedAnalysis).toBe(completed)
    }
  },
)

it("produces interoperable ZIP and CSV with full Unicode, CRCs, timestamps and formula protection", () => {
  const csv = toCsv(
    [{ item: '日本語,"quoted"\nline', formula: "=1+1", score: "6" }],
    ["item", "formula", "score"],
  )
  expect(csv).toContain('"日本語,""quoted""\nline"')
  expect(csv).toContain('"\'=1+1"')
  expect(csv.startsWith("\uFEFF")).toBe(true)
  expect(
    sourceRows([
      {
        id: "a",
        data: { submittedAt: { seconds: 1, nanoseconds: 500_000_000 } },
      },
    ])[0].submittedAtUtc,
  ).toBe("1970-01-01T00:00:01.500Z")
  const files = {
    "research/source.json": '{"PE1":null}',
    "research/analysis-questionnaires.csv": csv,
  }
  expect(readArchive(exportArchive(files))).toEqual(files)
})

it("preserves numeric strings, numbers, missing and invalid measurements in ZIP source JSON", () => {
  const source = fixtureSource()
  addPerson(source, "participant")
  addAnalysis(source, "participant", "analysis", {
    processingDurationSeconds: " 12.50 ",
    documentCount: 2,
    documentGraphemeCount: null,
    resultGraphemeCount: "not measured",
  })
  source.attempts[0].data.durationMs = "1.2e3"
  source.attempts[0].data.documentGraphemeCounts = ["0012", 34]
  const exported = buildRawExport(source)
  const files = readArchive(
    exportArchive(
      researchFiles(exported, syntheticArchives(exported.questionnaires)),
    ),
  )
  const json = JSON.parse(files["source.json"])
  expect(json.analysisQuestionnaires[0].data).toMatchObject({
    processingDurationSeconds: " 12.50 ",
    documentCount: 2,
    documentGraphemeCount: null,
    resultGraphemeCount: "not measured",
  })
  expect(json.attempts[0].data).toMatchObject({
    durationMs: "1.2e3",
    documentGraphemeCounts: ["0012", 34],
  })
  expect(source.analysisQuestionnaires[0].data.processingDurationSeconds).toBe(
    " 12.50 ",
  )
})

it("retains invalid stored timestamps without deriving UTC columns or document IDs", async () => {
  const source = fixtureSource()
  addPerson(source, "invalid-date")
  source.participationEvents[0].data.encryptedEmail = "synthetic-ciphertext"
  source.participationEvents[0].data.consentConfirmedAt = {
    seconds: 1,
    nanoseconds: -1,
  }
  source.emailConfirmations = []
  const access = await buildAccessExport(
    source,
    async () => "person@example.invalid",
    "synthetic-secret",
  )
  expect(access.participationEvents[0].data).toMatchObject({
    consentConfirmedAt: { seconds: 1, nanoseconds: -1 },
    did: null,
  })
  expect(sourceRows(access.participationEvents)[0]).not.toHaveProperty(
    "consentConfirmedAtUtc",
  )
  expect(accessFiles(access)["participation-events.csv"]).toContain(
    '"{""seconds"":1,""nanoseconds"":-1}"',
  )
})

it("preserves answers that overlap with export columns across the entire CSV", () => {
  const timestamp = { seconds: 1, nanoseconds: 0 }
  const source = fixtureSource()
  source.analysisQuestionnaires = [
    {
      id: "first-document",
      data: {
        submittedAt: timestamp,
        sourceDocumentId: "first answer",
        submittedAtUtc: "custom answer",
      },
    },
    {
      id: "second-document",
      data: {
        sourceDocumentId: "second answer",
        submittedAt: timestamp,
      },
    },
  ]
  const research = buildRawExport(source, {})
  const rows = sourceRows(research.analysisQuestionnaires)
  expect(rows).toEqual([
    {
      sourceDocumentId: "first-document",
      "data.sourceDocumentId": "first answer",
      submittedAt: timestamp,
      submittedAtUtc: "custom answer",
    },
    {
      sourceDocumentId: "second-document",
      "data.sourceDocumentId": "second answer",
      submittedAt: timestamp,
    },
  ])
  const files = readArchive(
    exportArchive(
      researchFiles(research, syntheticArchives(research.questionnaires)),
    ),
  )
  expect(files["analysis-questionnaires.csv"]).toContain(
    '"data.sourceDocumentId"',
  )
  expect(files["analysis-questionnaires.csv"]).toContain('"first answer"')
  expect(files["analysis-questionnaires.csv"]).toContain('"custom answer"')
  expect(JSON.parse(files["source.json"]).analysisQuestionnaires).toEqual(
    source.analysisQuestionnaires,
  )
})

it("escapes existing data prefixes without losing legacy source fields", () => {
  const data = {
    sourceDocumentId: "answer",
    "data.sourceDocumentId": "legacy answer",
    "data.data.sourceDocumentId": null,
  }
  expect(sourceRows([{ id: "actual-document", data }])).toEqual([
    {
      sourceDocumentId: "actual-document",
      "data.sourceDocumentId": "answer",
      "data.data.sourceDocumentId": "legacy answer",
      "data.data.data.sourceDocumentId": null,
    },
  ])
})

it("leaves absent cells empty even when a column matches an inherited property", () => {
  expect(toCsv([{ toString: "answer" }, {}])).toBe(
    '\uFEFF"toString"\r\n"answer"\r\n""\r\n',
  )
  expect(toCsv([{}], ["constructor", "__proto__", "valueOf"])).toBe(
    '\uFEFF"constructor","__proto__","valueOf"\r\n"","",""\r\n',
  )
})

it("exports retained run observations without reconstructing them from research copies", async () => {
  const source = fixtureSource()
  source.emailConfirmations = []
  addPerson(source, "participant")
  addAnalysis(source, "participant", "research-only")
  source.analysisRuns = [
    {
      id: "retained",
      data: {
        pseudonym: "participant",
        analysisId: "retained",
        presentationRecordedAt: { seconds: 10, nanoseconds: 123456789 },
        submittedAt: { seconds: 20, nanoseconds: 987654321 },
        questionnaireDeletedAt: { seconds: 30, nanoseconds: 0 },
        answers: { q1: "private-answer" },
        durationMs: 1000,
      },
    },
  ]
  const exported = await buildAccessExport(source, vi.fn(), "synthetic-key")
  expect(exported.analysisAccess.map(({ id }) => id)).toEqual(["retained"])
  expect(exported.surveyAccess.map(({ id }) => id)).toEqual(["retained"])
  expect(exported.surveyAccess[0].data.submittedAt).toEqual({
    seconds: 20,
    nanoseconds: 987654321,
  })
  expect(JSON.stringify(accessFiles(exported))).not.toMatch(
    /private-answer|durationMs|research-only/,
  )
})

it("excludes withdrawn durations before cleanup and after reentry without inferring durations from audit times", async () => {
  const source = { ...fixtureSource(), emailConfirmations: [] }
  addPerson(source, "participant")
  addAnalysis(source, "participant", "old", { processingDurationSeconds: 9 })
  source.participationEvents.push({
    id: "withdrawal-1",
    data: {
      pseudonym: "participant",
      consentId: "consent-participant",
      eventType: "withdrawal",
      consentBoundaryId: null,
      withdrawalAcceptedAt: "2026-01-03T00:00:00Z",
    },
  })
  source.participationEvents.push({
    id: "new-consent",
    data: {
      pseudonym: "participant",
      consentId: "new-consent",
      eventType: "consent",
      precedingWithdrawalId: "withdrawal-1",
    },
  })
  const fresh = addAnalysis(source, "participant", "new", {
    consentId: "new-consent",
    processingDurationSeconds: 13,
  })
  source.attempts[1].data.consentId = "new-consent"
  const exported = buildRawExport(source)
  expect(exported.analysisQuestionnaires.map(({ id }) => id)).toEqual(["new"])
  expect(exported.attempts.map(({ id }) => id)).toEqual(["new"])
  expect(
    exported.analysisQuestionnaires[0].data.processingDurationSeconds,
  ).toBe(13)
  expect(exported.attempts[0].data.durationMs).toBe(5000)
  expect(exported.manifest.excludedRecords).toBe(2)
  source.analysisQuestionnaires = [fresh]
  source.attempts = []
  source.analysisRuns = [
    {
      id: "old",
      data: {
        pseudonym: "participant",
        startedAtMs: 1000,
        endedAtMs: 6000,
        outcome: "completed",
        processingDurationSeconds: 9,
        durationMs: 5000,
      },
    },
  ]
  const access = await buildAccessExport(
    source,
    async () => "unused@example.invalid",
    "synthetic-key",
  )
  expect(access.analysisAccess[0].data.startedAtMs).toBe(1000)
  expect(access.analysisAccess[0].data).not.toHaveProperty("durationMs")
  expect(access.analysisAccess[0].data).not.toHaveProperty(
    "processingDurationSeconds",
  )
  expect(
    buildRawExport(source).analysisQuestionnaires[0].data
      .processingDurationSeconds,
  ).toBe(13)
})

it("fails an unresolved withdrawn boundary and preserves missing valid-period durations as missing", () => {
  const source = fixtureSource()
  addPerson(source, "participant")
  const row = addAnalysis(source, "participant", "analysis")
  delete row.data.processingDurationSeconds
  delete source.attempts[0].data.durationMs
  const data = buildRawExport(source)
  expect(data.analysisQuestionnaires[0].data).not.toHaveProperty(
    "processingDurationSeconds",
  )
  expect(data.attempts[0].data).not.toHaveProperty("durationMs")
  source.participationStates[0].data.status = "withdrawn"
  expect(() => buildRawExport(source)).toThrow("Withdrawal history unresolved")
})

it("preserves result-loss observations and full recovery provenance in their respective exports", async () => {
  const source = { ...fixtureSource(), emailConfirmations: [] }
  addPerson(source, "participant")
  addAnalysis(source, "participant", "analysis", {
    resultUnavailableAt: { seconds: 1, nanoseconds: 123 },
    unavailability: { reason: "result_unavailable" },
  })
  expect(buildRawExport(source).analysisQuestionnaires[0].data).toMatchObject({
    resultUnavailableAt: { seconds: 1, nanoseconds: 123 },
    unavailability: { reason: "result_unavailable" },
  })
  source.participationEvents.push({
    id: "recovery",
    data: {
      pseudonym: "participant",
      eventType: "recovery_authorized",
      reason: "Reviewed",
      actorId: "hashed-actor",
      destination: "initial-survey",
      sourceOwner: { consentId: "original" },
      expectedStudyGeneration: null,
      usedConsentId: "replacement",
      consumedAt: { seconds: 2, nanoseconds: 456 },
    },
  })
  const access = await buildAccessExport(
    source,
    async () => "unused@example.invalid",
    "synthetic-key",
  )
  expect(access.participationEvents[1].data).toMatchObject({
    reason: "Reviewed",
    actorId: "hashed-actor",
    sourceOwner: { consentId: "original" },
    usedConsentId: "replacement",
    consumedAt: { seconds: 2, nanoseconds: 456 },
  })
})

it("allows complete JSON download independently of an excessively wide CSV", () => {
  const source = fixtureSource()
  for (let index = 0; index < 1100; index++)
    source.analysisQuestionnaires.push({
      id: `row-${index}`,
      data: { [`field-${index}`]: "synthetic" },
    })
  const raw = buildRawExport(source)
  expect(() => researchFiles(raw, {})).toThrow("CSV capacity")
  const files = researchFiles(raw, {}, "source.json")
  expect(Object.keys(files)).toEqual(["source.json"])
  expect(JSON.parse(files["source.json"]).analysisQuestionnaires).toHaveLength(
    1100,
  )
})
