import followUpDefinition from "@aerpp-surveys/survey-follow-up.json"
import initialDefinition from "@aerpp-surveys/survey-initial.json"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: { participantApiServerId: "all" },
}))
const { get, select } = vi.hoisted(() => ({ get: vi.fn(), select: vi.fn() }))
vi.mock("@/lib/firestore", () => ({
  firestore: {
    collection: () => ({
      select: (...fields: string[]) => {
        select(fields)
        return { get }
      },
    }),
  },
}))

import {
  type AnalysisAttemptRecord,
  buildParticipantSummary,
  buildRecentActivity,
  buildSurveyItemSummaries,
  buildSurveySummary,
  buildSurveyUpdates,
  formatDateTime,
  loadParticipationEventRecords,
  loadSurveyRecords as readSurveyRecords,
  type SurveyRecord,
} from "./participant-records"

let analysisAttempts: AnalysisAttemptRecord[] = []

function snapshot(records: Record<string, unknown>[]) {
  const docs = records.map((data, index) => {
    const id = `record-${index}`
    const itemIds = new Set(
      [...initialDefinition.items, ...followUpDefinition.items].flatMap(
        (item) => (item.item_id ? [item.item_id] : []),
      ),
    )
    const stored: Record<string, unknown> = {
      dataPurpose: "research",
      ...(data.questionnaireKind
        ? {
            analysisId: id,
            clientId: "synthetic-client",
            pseudonym: "synthetic-participant",
            serverId: "synthetic-server",
            consentId: "synthetic-consent",
          }
        : {}),
      ...data,
      questionnaire: {
        kind: data.questionnaireKind ?? "initial",
        definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
      },
      answers: {
        ...Object.fromEntries(
          (data.questionnaireKind === "follow-up"
            ? followUpDefinition
            : initialDefinition
          ).items.flatMap((item) =>
            item.item_id ? [[item.item_id, null]] : [],
          ),
        ),
        ...Object.fromEntries(
          Object.entries(data).filter(([key]) => itemIds.has(key)),
        ),
      },
    }
    return { id, data: () => stored }
  })
  analysisAttempts = docs.flatMap((doc) => {
    const data = doc.data()
    if (
      data.questionnaireKind !== "initial" &&
      data.questionnaireKind !== "follow-up"
    )
      return []
    return [
      {
        id: doc.id,
        dataPurpose: "research" as const,
        clientId: data.clientId as string,
        pseudonym: data.pseudonym as string,
        serverId: data.serverId as string,
        consentId: data.consentId as string,
        questionnaireKind: data.questionnaireKind,
        startedAt: new Date(0),
        outcome: "completed",
        documentGraphemeCounts: [],
        durationMs: 1,
      },
    ]
  })
  get.mockResolvedValue({ docs })
}

function loadSurveyRecords(
  serverId: string,
  purpose?: Parameters<typeof readSurveyRecords>[1],
) {
  return readSurveyRecords(serverId, purpose, analysisAttempts)
}

function questionItemId(item: { item_id?: string }) {
  if (typeof item.item_id !== "string")
    throw new Error("Expected a questionnaire item ID")
  return item.item_id
}

beforeEach(() => vi.clearAllMocks())

it("uses explicit confirmation and acceptance times for consent history, status and activity", async () => {
  snapshot([
    {
      pseudonym: "person",
      eventType: "consent",
      consentRequestedAt: new Date(500),
      consentConfirmedAt: new Date(1000),
    },
    {
      pseudonym: "person",
      eventType: "withdrawal",
      withdrawalAcceptedAt: new Date(2000),
    },
  ])
  const records = await loadParticipationEventRecords("all")
  expect(records.map((record) => record.eventAt)).toEqual([
    new Date(2000),
    new Date(1000),
  ])
  expect(records[1].consentRequestedAt).toEqual(new Date(500))
  expect(records[0].consentRequestedAt).toBeNull()
  expect(buildParticipantSummary(records).latestStatusCounts).toEqual([
    { eventType: "withdrawal", count: 1 },
  ])
  expect(
    buildRecentActivity(records, []).map((item) => item.createdAt),
  ).toEqual([new Date(2000), new Date(1000)])
})

describe("survey records", () => {
  it("loads each recorded analysis version without substituting the Admin version", async () => {
    snapshot([
      { analysisWorkspaceVersion: "1.0.0" },
      { analysisWorkspaceVersion: "1.0.1" },
    ])
    expect(
      (await loadSurveyRecords("all")).map(
        (row) => row.analysisWorkspaceVersion,
      ),
    ).toEqual(["1.0.0", "1.0.1"])
    expect(select.mock.calls.at(-1)?.[0]).toContain("analysisWorkspaceVersion")
  })
  it.each([
    undefined,
    "",
    null,
    "unknown-version",
    initialDefinition.survey_version,
  ])(
    "uses the recorded attempt kind regardless of survey version %j",
    async (surveyVersion) => {
      snapshot([
        {
          questionnaireKind: "follow-up",
          surveyVersion,
          submittedAt: new Date(1000),
          PE_F1: "7",
        },
      ])
      const records = await loadSurveyRecords("all")
      expect(records[0].surveyKind).toBe("follow-up")
      expect(
        buildSurveyItemSummaries(records, "follow-up").find(
          (item) => item.itemId === "PE_F1",
        ),
      ).toMatchObject({
        responseCount: 1,
      })
    },
  )

  it.each(["clientId", "pseudonym", "serverId", "consentId", "id"] as const)(
    "does not use an unrelated attempt with a different %s",
    async (field) => {
      snapshot([
        {
          questionnaireKind: "initial",
          surveyVersion: initialDefinition.survey_version,
        },
      ])
      analysisAttempts[0][field] = "different"
      expect((await loadSurveyRecords("all"))[0].surveyKind).toBe("unknown")
    },
  )

  it("does not infer a missing attempt from a recognized version", async () => {
    snapshot([
      {
        surveyVersion: initialDefinition.survey_version,
        submittedAt: new Date(1000),
        PE1: "7",
      },
    ])
    expect((await loadSurveyRecords("all"))[0].surveyKind).toBe("unknown")
  })

  it.each([
    ["initial", initialDefinition],
    ["follow-up", followUpDefinition],
  ] as const)(
    "aggregates one submitted %s questionnaire using the labels stored by Web",
    async (kind, definition) => {
      const labels = definition.types.find(
        (type) => type.type === "likert7",
      )?.labels
      const answerLabels = Object.values(labels ?? {})
      const items = definition.items.filter((item) => item.type !== "section")
      const answers = Object.fromEntries(
        items.map((item) => [
          item.item_id,
          item.type === "likert7"
            ? answerLabels[0]
            : item.type === "single_choice"
              ? item.options?.[0]
              : "Synthetic text",
        ]),
      )
      snapshot([
        {
          surveyVersion: definition.survey_version,
          questionnaireKind: kind,
          submittedAt: new Date(1000),
          ...answers,
        },
      ])

      const records = await loadSurveyRecords("all")
      expect(buildSurveySummary(records)).toMatchObject({
        totalAnalyses: 1,
        totalResponses: 1,
      })
      expect(records[0].answers).toEqual(answers)
      expect(buildSurveyItemSummaries(records, kind)).toEqual(
        items
          .map((item) => ({
            itemId: questionItemId(item),
            definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
            responseCount: 1,
          }))
          .sort((a, b) => a.itemId.localeCompare(b.itemId)),
      )
    },
  )

  it.each([
    ["initial", initialDefinition],
    ["follow-up", followUpDefinition],
  ] as const)(
    "counts stored %s answers without converting labels, checking score ranges or reversing values",
    async (kind, definition) => {
      const item = definition.items.find((item) => item.type === "likert7")
      if (!item?.item_id) throw new Error("Expected a questionnaire item")
      const originalReverse = item.reverse
      item.reverse = true
      try {
        snapshot(
          [
            "Synthetic label",
            "0",
            "6",
            "7",
            "8",
            "1.5",
            "-1",
            "unknown",
            undefined,
            "",
            " ",
            null,
            3,
          ].map((answer) => ({
            questionnaireKind: kind,
            submittedAt: new Date(1000),
            [item.item_id]: answer,
          })),
        )
        const records = await loadSurveyRecords("all")
        const originalAnswers = structuredClone(
          records.map((record) => record.answers),
        )
        expect(
          buildSurveyItemSummaries(records, kind).find(
            (summary) => summary.itemId === item.item_id,
          ),
        ).toEqual({
          itemId: item.item_id,
          definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
          responseCount: 8,
        })
        expect(records.map((record) => record.answers)).toEqual(originalAnswers)
      } finally {
        item.reverse = originalReverse
      }
    },
  )

  it("reads numeric metadata and nested answers before filtering and sorting", async () => {
    snapshot([
      {
        serverId: "a",
        createdAt: { seconds: 1 },
        documentCount: 2,
        processingDurationSeconds: 12.5,
        PE1: "7",
      },
      {
        serverId: "b",
        createdAt: { toDate: () => new Date(3000) },
        documentCount: 4,
      },
      {
        serverId: "a",
        createdAt: new Date(2000),
        documentCount: 4,
        processingDurationSeconds: 7.5,
        PE_F1: "3",
        unrelated: "private",
      },
    ])
    const records = await loadSurveyRecords("a")
    expect(records.map((record) => record.id)).toEqual(["record-2", "record-0"])
    expect(records[0].createdAt).toEqual(new Date(2000))
    expect(records[0].answers).toMatchObject({ PE_F1: "3" })
    expect(records[1].answers).toMatchObject({ PE1: "7" })
    expect(records[0].documentCount).toBe(4)
    expect(records[1].processingDurationSeconds).toBe(12.5)
    expect(await loadSurveyRecords("all")).toHaveLength(3)
  })

  it("normalizes numeric strings only in monitoring measurements", async () => {
    snapshot([
      {
        documentCount: "2",
        processingDurationSeconds: "12.5",
        resultGraphemeCount: "5",
      },
    ])
    const [record] = await loadSurveyRecords("all")
    expect(record.documentCount).toBe(2)
    expect(record.processingDurationSeconds).toBe(12.5)
    expect(record.resultGraphemeCount).toBe(5)
  })

  it.each([
    [" 0 ", 0],
    [".5", 0.5],
    ["1e2", 100],
    ["-1", -1],
    ["", null],
    ["  ", null],
    ["0x10", null],
    ["1 second", null],
    ["Infinity", null],
    ["NaN", null],
    ["1e999", null],
    [true, null],
    [false, null],
    [null, null],
    [[], null],
    [{ value: 1 }, null],
  ])(
    "normalizes measurement %j as %j without coercing other types",
    async (value, expected) => {
      snapshot([{ processingDurationSeconds: value }])
      const [record] = await loadSurveyRecords("all")
      expect(record.processingDurationSeconds).toBe(expected)
    },
  )

  it("uses safe defaults for missing or malformed fields", async () => {
    snapshot([
      {
        id: "untrusted",
        createdAt: "invalid",
        documentCount: "",
        processingDurationSeconds: true,
        resultGraphemeCount: "Infinity",
        PE1: { value: 7 },
      },
    ])
    const [record] = await loadSurveyRecords("all")
    expect(record).toMatchObject({
      id: "record-0",
      pseudonym: "record-0",
      serverId: "unknown",
      createdAt: null,
      documentCount: null,
      processingDurationSeconds: null,
      resultGraphemeCount: null,
      answers: {},
    })
  })

  it("counts initial and follow-up answers without interpreting their text as scores", async () => {
    snapshot([
      {
        submittedAt: new Date(1000),
        surveyVersion: initialDefinition.survey_version,
        questionnaireKind: "initial",
        PE1: "非常にそう思う",
        PE_F1: "7",
      },
      {
        submittedAt: new Date(1000),
        surveyVersion: followUpDefinition.survey_version,
        questionnaireKind: "follow-up",
        PE1: "1",
        PE_F1: "あまりそう思わない",
      },
      {
        submittedAt: new Date(1000),
        surveyVersion: initialDefinition.survey_version,
        questionnaireKind: "initial",
        PE1: "5",
        PE_F1: "",
      },
      {
        submittedAt: new Date(1000),
        surveyVersion: initialDefinition.survey_version,
        questionnaireKind: "initial",
        PE1: "8",
        PE_F1: "0",
      },
      {
        submittedAt: new Date(1000),
        surveyVersion: initialDefinition.survey_version,
        questionnaireKind: "initial",
        PE1: "1.5",
        PE_F1: "invalid",
      },
      {
        submittedAt: new Date(1000),
        surveyVersion: "unrecognized",
        PE1: "全くそう思わない",
        PE_F1: "非常にそう思う",
      },
      {
        surveyVersion: initialDefinition.survey_version,
        questionnaireKind: "initial",
        PE1: "全くそう思わない",
      },
      {
        submittedAt: new Date(1000),
        surveyVersion: initialDefinition.survey_version,
        questionnaireKind: "initial",
        PE1: "定義にない選択肢",
      },
      {},
    ])
    const records = await loadSurveyRecords("all")
    const summaries = buildSurveyItemSummaries(records, "initial")
    const followUpSummaries = buildSurveyItemSummaries(records, "follow-up")
    expect(summaries.find((item) => item.itemId === "PE1")).toMatchObject({
      responseCount: 5,
    })
    expect(
      followUpSummaries.find((item) => item.itemId === "PE_F1"),
    ).toMatchObject({
      responseCount: 1,
    })
    expect(summaries.find((item) => item.itemId === "PE2")).toMatchObject({
      responseCount: 0,
    })
    expect(summaries.some((item) => item.itemId === "TX1")).toBe(true)
    expect(summaries.map((item) => item.itemId)).toEqual(
      [
        ...initialDefinition.items
          .filter((item) => item.type !== "section")
          .map(questionItemId),
        "PE_F1",
      ].sort((a, b) => a.localeCompare(b)),
    )
    expect(records.some((record) => record.surveyKind === "unknown")).toBe(true)
  })
})

describe("metadata and submitted answer phases", () => {
  it("counts analyses separately and only counts submitted responses and respondents", async () => {
    snapshot([
      {
        serverId: "a",
        pseudonym: "pending",
        createdAt: new Date(4000),
        documentCount: 5,
        processingDurationSeconds: 30,
        PE1: "1",
      },
      {
        serverId: "a",
        pseudonym: "respondent",
        createdAt: new Date(1000),
        submittedAt: { seconds: 5 },
        surveyVersion: initialDefinition.survey_version,
        questionnaireKind: "initial",
        documentCount: 1,
        processingDurationSeconds: 10,
        PE1: "7",
      },
      {
        serverId: "a",
        pseudonym: "respondent",
        createdAt: new Date(2000),
        submittedAt: { toDate: () => new Date(3000) },
        surveyVersion: followUpDefinition.survey_version,
        questionnaireKind: "follow-up",
        documentCount: 3,
        processingDurationSeconds: 20,
        PE_F1: "5",
      },
      {
        serverId: "b",
        pseudonym: "other",
        createdAt: new Date(6000),
        submittedAt: new Date(7000),
        PE1: "3",
      },
    ])
    const filtered = await loadSurveyRecords("a")
    expect(buildSurveySummary(filtered)).toEqual({
      totalAnalyses: 3,
      totalResponses: 2,
      uniqueParticipants: 1,
    })
    expect(buildSurveySummary(await loadSurveyRecords("all"))).toMatchObject({
      totalAnalyses: 4,
      totalResponses: 3,
      uniqueParticipants: 2,
    })
    expect(
      buildSurveyItemSummaries(filtered, "initial").find(
        (item) => item.itemId === "PE1",
      ),
    ).toMatchObject({ responseCount: 1 })
    expect(
      buildSurveyUpdates(filtered).map((item) => [item.id, item.createdAt]),
    ).toEqual([
      ["survey-record-1", new Date(5000)],
      ["survey-record-2", new Date(3000)],
    ])
    expect(buildRecentActivity([], filtered)).toEqual(
      buildSurveyUpdates(filtered),
    )
  })

  it("uses submission time before limiting activity, including old analyses answered recently", async () => {
    snapshot(
      Array.from({ length: 12 }, (_, index) => ({
        createdAt: new Date((index + 1) * 1000),
        submittedAt: new Date((20 - index) * 1000),
      })),
    )
    const records = await loadSurveyRecords("all")
    expect(buildSurveyUpdates(records).map((item) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `survey-record-${index}`),
    )
    expect(records[0].id).toBe("record-11")
  })

  it("never infers submission from answers or malformed timestamps", async () => {
    snapshot(
      [
        undefined,
        null,
        "invalid",
        new Date(Number.NaN),
        { seconds: Infinity },
        { toDate: () => new Date(Number.NaN) },
        "2026-02-30T12:00:00Z",
        "2026-09-28T12:00:00",
        "2026-09-28",
        "1",
        { seconds: 1, nanoseconds: -1 },
      ].map((submittedAt) => ({ submittedAt, PE1: "7" })),
    )
    const records = await loadSurveyRecords("all")
    expect(records.every((record) => record.submittedAt === null)).toBe(true)
    expect(buildSurveySummary(records)).toMatchObject({
      totalAnalyses: 11,
      totalResponses: 0,
      uniqueParticipants: 0,
    })
    expect(buildSurveyUpdates(records)).toEqual([])
    expect(
      buildSurveyItemSummaries(records, "initial").every(
        (item) => item.responseCount === 0,
      ),
    ).toBe(true)
    expect(buildSurveySummary([])).toEqual({
      totalAnalyses: 0,
      totalResponses: 0,
      uniqueParticipants: 0,
    })
  })
})

it("separates terminal observations from unconfirmed starts and filters execution records", async () => {
  const { loadAnalysisAttempts } = await import("./participant-records")
  snapshot([
    {
      serverId: "a",
      consentId: "first-consent",
      startedAtMs: 1000,
      outcome: "started",
      documentGraphemeCounts: [12, 34],
      questionnaireKind: "initial",
    },
    {
      serverId: "b",
      startedAtMs: 2000,
      outcome: "completed",
      durationMs: 100,
      documentGraphemeCounts: [20],
    },
    {
      serverId: "a",
      consentId: "renewed-consent",
      startedAtMs: 3000,
      outcome: "cancelled",
      durationMs: 200,
      documentGraphemeCounts: [10],
      questionnaireKind: "follow-up",
    },
    { serverId: "a", startedAtMs: 4000, outcome: "failed", durationMs: 300 },
  ])
  const records = await loadAnalysisAttempts("a")
  expect(records.map((record) => record.outcome)).toEqual([
    "failed",
    "cancelled",
    "unconfirmed",
  ])
  expect(records[2]).toMatchObject({
    consentId: "first-consent",
    durationMs: null,
    documentGraphemeCounts: [12, 34],
    questionnaireKind: "initial",
  })
  expect(records[1].consentId).toBe("renewed-consent")
  expect(await loadAnalysisAttempts("all")).toHaveLength(4)
})

it("defaults to research and keeps test, missing and invalid purposes out of counts before limiting", async () => {
  snapshot([
    { serverId: "a", dataPurpose: "research", submittedAt: new Date(1000) },
    { serverId: "a", dataPurpose: "test", submittedAt: new Date(1000) },
    { serverId: "a", dataPurpose: undefined, submittedAt: new Date(1000) },
    { serverId: "b", dataPurpose: "unexpected", submittedAt: new Date(1000) },
  ])
  expect(
    buildSurveySummary(await loadSurveyRecords("all")).totalResponses,
  ).toBe(1)
  expect((await loadSurveyRecords("a", "test")).map((row) => row.id)).toEqual([
    "record-1",
  ])
  expect(
    (await loadSurveyRecords("all", "unclassified")).map((row) => row.id),
  ).toEqual(["record-2", "record-3"])
  expect(await loadSurveyRecords("a", "all")).toHaveLength(3)
})

it("labels Japan time consistently across the UTC day boundary", () => {
  expect(formatDateTime(new Date("2026-09-30T15:30:00Z"))).toBe(
    "2026/10/01 0:30（日本時間）",
  )
  expect(formatDateTime(null)).toBe("日時不明")
})

it("excludes contact and receipt fields from monitoring queries", async () => {
  snapshot([
    {
      eventType: "consent",
      encryptedEmail: "synthetic-ciphertext",
      _integrity: { private: true },
      PE1: "answer",
    },
  ])
  const events = await loadParticipationEventRecords("all")
  expect(events[0]).not.toHaveProperty("encryptedEmail")
  await readSurveyRecords("all", "research", [], { includeAnswers: false })
  for (const [fields] of select.mock.calls) {
    expect(fields).not.toContain("encryptedEmail")
    expect(fields).not.toContain("_integrity")
    expect(fields).not.toContain("PE1")
  }
})

it("separates identical question IDs from different definitions and retains zero counts", () => {
  const base = {
    dataPurpose: "research" as const,
    submittedAt: new Date(1000),
    surveyKind: "initial" as const,
    analysisId: null,
    analysisWorkspaceVersion: "1.0.0",
    clientId: "synthetic-client",
    createdAt: null,
    documentCount: null,
    documentGraphemeCount: null,
    modelName: null,
    processingDurationSeconds: null,
    pseudonym: "synthetic-participant",
    resultGraphemeCount: null,
    serverId: "synthetic-server",
    answers: { Q1: "answer", Q2: null },
  }
  const records: SurveyRecord[] = [
    { ...base, id: "first", definitionId: `jcs-v1:sha256:${"a".repeat(64)}` },
    { ...base, id: "second", definitionId: `jcs-v1:sha256:${"b".repeat(64)}` },
  ]
  const summaries = buildSurveyItemSummaries(records, "initial")
  expect(summaries).toHaveLength(4)
  expect(
    summaries
      .filter((item) => item.itemId === "Q1")
      .map((item) => item.responseCount),
  ).toEqual([1, 1])
  expect(
    summaries
      .filter((item) => item.itemId === "Q2")
      .map((item) => item.responseCount),
  ).toEqual([0, 0])
})
