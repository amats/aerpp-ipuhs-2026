import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import type { Firestore } from "@google-cloud/firestore"
import type { Request, Response } from "express"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryFirestore, Timestamp } from "../test-support/firestore.js"

vi.mock("@google-cloud/firestore", () => ({
  Timestamp,
  FieldValue: { serverTimestamp: () => Timestamp.now() },
}))

const mock = vi.hoisted(() => ({
  db: undefined as unknown,
  info: vi.fn(),
  error: vi.fn(),
}))
vi.mock("./logger.js", () => ({ logger: mock }))
vi.mock("./storage.js", () => ({
  getFirestore: () => mock.db,
  getParticipantRepository: () =>
    createParticipantRepository(mock.db as Firestore),
  Timestamp,
  FieldValue: { serverTimestamp: () => Timestamp.now() },
}))

import * as api from "./participant-handlers.js"
import { getParticipationStateRef } from "./participant-state.js"

const owner = {
  serverId: "server-1",
  clientId: "client-1",
  pseudonym: "participant-1",
  consentId: "test-consent",
}
const metadata = {
  ...owner,
  analysisId: "analysis-1",
  analysisWorkspaceVersion: "1.0.0",
  model: "model-1",
}
const answer = {
  ...owner,
  analysisId: "analysis-1",
  questionnaire: {
    kind: "initial",
    definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
  },
  answers: { q1: "yes", q2: null },
}
const withdrawal = {
  ...owner,
  documentSet: { version: "1.0", sha256: "a".repeat(64) },
  encryptedEmail: "private-ciphertext",
}
const now = Date.parse("2026-09-20T12:00:00Z")
let db: MemoryFirestore
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture")
  return value
}
async function call(
  handler: (req: Request, res: Response) => unknown,
  body: unknown,
) {
  const result = {
    statusCode: 200,
    body: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(value: Record<string, unknown>) {
      this.body = value
      return this
    },
  }
  await handler({ body } as Request, result as unknown as Response)
  return result
}
function ok(result: Awaited<ReturnType<typeof call>>) {
  expect(result.statusCode).toBe(200)
  expect(result.body).toMatchObject({ ok: true })
}
function code(
  result: Awaited<ReturnType<typeof call>>,
  status: number,
  errorCode: string,
) {
  expect(result.statusCode).toBe(status)
  expect(result.body.code).toBe(errorCode)
}
const analysisQuestionnaires = () =>
  [...db.records].filter(([path]) => path.startsWith("analysisQuestionnaires/"))
const events = () =>
  [...db.records].filter(
    ([path, data]) =>
      path.startsWith("participationEvents/") &&
      data.eventType === "withdrawal",
  )
it.each(["initial-ready", "follow-up"])(
  "verification uses %s state even with unrelated historical answers",
  async (studyStatus) => {
    const stateRef = getParticipationStateRef(owner.pseudonym)
    db.seed(stateRef.path, { ...db.data(stateRef.path), studyStatus })
    await db
      .collection("analysisQuestionnaires")
      .doc("historical-answer")
      .set({
        ...owner,
        analysisId: "historical-answer",
        submittedAt: Timestamp.now(),
      })
    const response = await call(api.verifyAuthentication, owner)
    ok(response)
    expect(response.body.questionnaireKind).toBe(
      studyStatus === "follow-up" ? "follow-up" : "initial",
    )
    await db.runTransaction(async (tx) => {
      tx.delete(
        db
          .collection("analysisQuestionnaires")
          .doc("historical-answer") as never,
      )
    })
    const withoutAnswers = await call(api.verifyAuthentication, owner)
    ok(withoutAnswers)
    expect(withoutAnswers.body.questionnaireKind).toBe(
      response.body.questionnaireKind,
    )
  },
)

async function prepareCompletedAttempt() {
  if (!db.data("analysisAttempts/analysis-1")) {
    ok(
      await call(api.recordAnalysisAttempt, {
        ...owner,
        analysisId: "analysis-1",
        outcome: "started",
        startedAtMs: now - 1000,
        documentGraphemeCounts: [10],
      }),
    )
    ok(
      await call(api.recordAnalysisAttempt, {
        ...owner,
        analysisId: "analysis-1",
        outcome: "completed",
        endedAtMs: now,
        durationMs: 1000,
      }),
    )
  }
}
async function present() {
  ok(
    await call(api.recordAnalysisAttempt, {
      ...owner,
      analysisId: "analysis-1",
      outcome: "presented",
    }),
  )
}
async function completeAndPresent() {
  await prepareCompletedAttempt()
  const result = await call(api.recordAnalysisCompletion, metadata)
  if (result.statusCode === 200) await present()
  return result
}
function seedAuth() {
  db.seed("emailConfirmations/pending", { ...owner, status: "sent" })
}
beforeEach(() => {
  vi.clearAllMocks()
  db = new MemoryFirestore()
  mock.db = db
  db.seed("emailConfirmations/test-consent", {
    ...owner,
    status: "completed",
    authenticationVersion: 2,
    precedingWithdrawalId: null,
  })
  db.seed("participationEvents/test-consent", {
    ...owner,
    eventType: "consent",
    precedingWithdrawalId: null,
    authenticationVersion: 2,
    consentConfirmedAt: Timestamp.fromMillis(now - 2000),
  })
  db.seed(getParticipationStateRef(owner.pseudonym).path, {
    pseudonym: owner.pseudonym,
    status: "active",
    consentBoundaryId: null,
  })
  vi.spyOn(Date, "now").mockReturnValue(now)
})

describe("participation state lookup", () => {
  it("returns the withdrawal boundary and unused grant without reading history", async () => {
    const stateRef = getParticipationStateRef(owner.pseudonym)
    const recovery = {
      recoveryId: "11111111-1111-4111-8111-111111111111",
      destination: "follow-up-document",
      reason: "private reason",
    }
    db.seed(stateRef.path, {
      ...db.data(stateRef.path),
      lastWithdrawalId: "withdrawal-1",
      recoveryAuthorization: recovery,
    })
    const query = vi.spyOn(db, "query")
    const response = await call(api.getParticipationState, {
      pseudonym: owner.pseudonym,
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({
      studyGeneration: null,
      lastWithdrawalId: "withdrawal-1",
      pendingRecovery: {
        recoveryId: recovery.recoveryId,
        destination: recovery.destination,
      },
    })
    expect(query).not.toHaveBeenCalled()
    db.seed(stateRef.path, {
      ...db.data(stateRef.path),
      recoveryAuthorization: { ...recovery, usedConsentId: owner.consentId },
    })
    expect(
      (await call(api.getParticipationState, { pseudonym: owner.pseudonym }))
        .body,
    ).toEqual({ studyGeneration: null, lastWithdrawalId: "withdrawal-1" })
  })

  it("rejects orphaned history instead of treating it as a new participant", async () => {
    db.records.delete(getParticipationStateRef(owner.pseudonym).path)
    code(
      await call(api.getParticipationState, { pseudonym: owner.pseudonym }),
      409,
      "PARTICIPATION_STATE_INVALID",
    )
    expect(
      (await call(api.getParticipationState, { pseudonym: "new-participant" }))
        .body,
    ).toEqual({ studyGeneration: null, lastWithdrawalId: null })
  })
})
describe("idempotent analysisQuestionnaires", () => {
  it("preserves Unicode answers and timestamps across identical retries", async () => {
    const unicodeAnswer = {
      ...answer,
      answers: { q1: "日本語😀", q2: "e\u0301" },
    }
    ok(await completeAndPresent())
    ok(await call(api.submitSurvey, unicodeAnswer))
    const first = db.data("analysisQuestionnaires/analysis-1")
    ok(await call(api.submitSurvey, unicodeAnswer))
    expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(first)
    code(
      await call(api.submitSurvey, {
        ...unicodeAnswer,
        answers: { ...unicodeAnswer.answers, q2: "é" },
      }),
      409,
      "SURVEY_ANSWER_CONFLICT",
    )
  })
  it.each([
    ["metadata", api.recordAnalysisCompletion],
    ["answers", api.submitSurvey],
  ] as const)(
    "rejects oversized receipt paths before Firestore access: %s",
    async (_name, handler) => {
      let fields: Record<string, unknown> = { ["l".repeat(64)]: "value" }
      for (let i = 0; i < 11; i++) fields = { ["k".repeat(128)]: fields }
      const collection = vi.spyOn(db, "collection")
      code(
        await call(handler, { ...metadata, ...fields }),
        400,
        "INVALID_REQUEST",
      )
      expect(collection).not.toHaveBeenCalled()
      expect([...db.records.keys()]).toEqual([
        "emailConfirmations/test-consent",
        "participationEvents/test-consent",
        getParticipationStateRef(owner.pseudonym).path,
      ])
    },
  )
  it("accepts identical metadata, including after answer submission, without writes", async () => {
    ok(await completeAndPresent())
    const first = db.data("analysisQuestionnaires/analysis-1")
    ok(
      await call(api.recordAnalysisCompletion, {
        model: "model-1",
        analysisId: "analysis-1",
        analysisWorkspaceVersion: "1.0.0",
        ...owner,
      }),
    )
    expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(first)
    ok(await call(api.submitSurvey, answer))
    const submitted = db.data("analysisQuestionnaires/analysis-1")
    ok(await completeAndPresent())
    expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(submitted)
  })
  it.each([undefined, "", null, 1, "a".repeat(129)])(
    "rejects invalid analysis workspace version %j before persistence",
    async (analysisWorkspaceVersion) => {
      await prepareCompletedAttempt()
      const records = [...db.records]
      code(
        await call(api.recordAnalysisCompletion, {
          ...metadata,
          analysisWorkspaceVersion,
        }),
        400,
        "INVALID_REQUEST",
      )
      expect([...db.records]).toEqual(records)
    },
  )
  it.each([false, true])(
    "preserves the analysis version and rejects relabelled metadata after submission=%s",
    async (submitted) => {
      ok(await completeAndPresent())
      if (submitted === true) ok(await call(api.submitSurvey, answer))
      const first = db.data("analysisQuestionnaires/analysis-1")
      expect(first).toMatchObject({
        analysisWorkspaceVersion: "1.0.0",
        _integrity: { metadata: { analysisWorkspaceVersion: "1.0.0" } },
      })
      code(
        await call(api.recordAnalysisCompletion, {
          ...metadata,
          analysisWorkspaceVersion: "1.0.1",
        }),
        409,
        "ANALYSIS_COMPLETION_CONFLICT",
      )
      ok(await call(api.recordAnalysisCompletion, metadata))
      expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(first)
    },
  )
  it("returns distinct metadata content and owner conflicts", async () => {
    ok(await completeAndPresent())
    code(
      await call(api.recordAnalysisCompletion, { ...metadata, model: "other" }),
      409,
      "ANALYSIS_COMPLETION_CONFLICT",
    )
    code(
      await call(api.recordAnalysisCompletion, {
        ...metadata,
        clientId: "other",
      }),
      409,
      "OWNER_CONFLICT",
    )
    code(
      await call(api.submitSurvey, { ...answer, pseudonym: "other" }),
      409,
      "OWNER_CONFLICT",
    )
  })
  it("retries after a lost response and retains the first submittedAt", async () => {
    ok(await completeAndPresent())
    expect(mock.info).not.toHaveBeenCalled()
    await call(api.submitSurvey, answer) // server commit succeeded; caller discards the response
    const first = required(db.data("analysisQuestionnaires/analysis-1"))
    vi.spyOn(Date, "now").mockReturnValue(now + 10000)
    ok(await call(api.submitSurvey, answer))
    expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(first)
    expect(first.submittedAt.toMillis()).toBe(now)
    expect(mock.info).not.toHaveBeenCalled()
    const receipts = [...db.records.values()].filter(
      (data) => data.eventType === "questionnaire_submitted",
    )
    expect(receipts).toHaveLength(1)
    expect(receipts[0].recordedAt.toMillis()).toBe(now)
  })
  it("ignores object key order recursively, but compares all answer fields", async () => {
    ok(await completeAndPresent())
    ok(await call(api.submitSurvey, answer))
    ok(
      await call(api.submitSurvey, {
        ...answer,
        answers: { q2: null, q1: "yes" },
      }),
    )
    for (const changed of [
      { ...answer, answers: { ...answer.answers, q1: "no" } },
      { ...answer, answers: { ...answer.answers, q2: "value" } },
      { ...answer, answers: { q1: "yes" } },
    ])
      code(await call(api.submitSurvey, changed), 409, "SURVEY_ANSWER_CONFLICT")
    expect(
      required(db.data("analysisQuestionnaires/analysis-1")).answers.q1,
    ).toBe("yes")
  })
  it("rejects changed questionnaire references without rewriting answers", async () => {
    ok(await completeAndPresent())
    ok(await call(api.submitSurvey, answer))
    const first = db.data("analysisQuestionnaires/analysis-1")
    for (const questionnaire of [
      {
        ...answer.questionnaire,
        definitionId: `jcs-v1:sha256:${"b".repeat(64)}`,
      },
      { ...answer.questionnaire, kind: "follow-up" },
    ])
      code(
        await call(api.submitSurvey, { ...answer, questionnaire }),
        409,
        "SURVEY_ANSWER_CONFLICT",
      )
    expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(first)
    code(
      await call(api.submitSurvey, { ...answer, surveyVersion: "old" }),
      400,
      "INVALID_REQUEST",
    )
  })
  it("rejects retired top-level surveyVersion without storing completion metadata", async () => {
    await prepareCompletedAttempt()
    code(
      await call(api.recordAnalysisCompletion, {
        ...metadata,
        surveyVersion: "retired",
      }),
      400,
      "INVALID_REQUEST",
    )
    expect(db.data("analysisQuestionnaires/analysis-1")).toBeUndefined()
    ok(await call(api.recordAnalysisCompletion, metadata))
  })
  it("compares every metadata field and preserves the original on retry conflicts", async () => {
    await prepareCompletedAttempt()
    const original = { ...metadata, details: { surveyVersion: "original" } }
    ok(await call(api.recordAnalysisCompletion, original))
    const first = db.data("analysisQuestionnaires/analysis-1")
    for (const changed of [
      { ...metadata, details: { surveyVersion: "changed" } },
      metadata,
    ])
      code(
        await call(api.recordAnalysisCompletion, changed),
        409,
        "ANALYSIS_COMPLETION_CONFLICT",
      )
    ok(await call(api.recordAnalysisCompletion, original))
    expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(first)
  })
  it("distinguishes missing metadata and field collisions", async () => {
    code(
      await call(api.submitSurvey, answer),
      404,
      "ANALYSIS_COMPLETION_NOT_FOUND",
    )
    ok(await completeAndPresent())
    code(
      await call(api.submitSurvey, { ...answer, model: "model-1" }),
      400,
      "INVALID_REQUEST",
    )
  })
  it("serializes identical concurrent metadata and answers", async () => {
    await prepareCompletedAttempt()
    for (const result of await Promise.all([
      call(api.recordAnalysisCompletion, metadata),
      call(api.recordAnalysisCompletion, metadata),
    ]))
      ok(result)
    await present()
    for (const result of await Promise.all([
      call(api.submitSurvey, answer),
      call(api.submitSurvey, answer),
    ]))
      ok(result)
    expect(analysisQuestionnaires()).toHaveLength(1)
    expect(db.retries).toBeGreaterThan(0)
    expect(mock.info).not.toHaveBeenCalled()
    expect(
      [...db.records.values()].filter(
        (data) => data.eventType === "questionnaire_submitted",
      ),
    ).toHaveLength(1)
  })
  it("rejects the loser of concurrent different submissions", async () => {
    ok(await completeAndPresent())
    const results = await Promise.all([
      call(api.submitSurvey, answer),
      call(api.submitSurvey, {
        ...answer,
        answers: { ...answer.answers, q1: "other" },
      }),
    ])
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409])
    expect(required(results.find((r) => r.statusCode === 409)).body.code).toBe(
      "SURVEY_ANSWER_CONFLICT",
    )
  })
})

describe("withdrawal and bounded cleanup", () => {
  it("acknowledges withdrawal before Web times out when cleanup exhausts its request budget", async () => {
    db.seed("analysisQuestionnaires/slow", metadata)
    db.beforeCommit = async () => {
      vi.mocked(Date.now).mockReturnValue(now + 5_000)
    }
    code(
      await call(api.withdrawParticipation, withdrawal),
      503,
      "WITHDRAWAL_CLEANUP_PENDING",
    )
    expect(
      db.data(getParticipationStateRef(owner.pseudonym).path),
    ).toMatchObject({
      status: "withdrawn",
      cleanupStatus: "pending",
      hasCompletedAnalysis: true,
    })
    expect(analysisQuestionnaires()).toHaveLength(1)
    expect(events()).toHaveLength(1)
    ok(await call(api.withdrawParticipation, withdrawal))
    expect(analysisQuestionnaires()).toHaveLength(0)
    expect(events()).toHaveLength(1)
  })
  it("deletes a save committed immediately before withdrawal", async () => {
    db.beforeCommit = async () => {
      ok(await completeAndPresent())
      ok(await call(api.submitSurvey, answer))
    }
    expect((await call(api.withdrawParticipation, withdrawal)).body).toEqual({
      ok: true,
      deletedCount: 1,
      hasCompletedAnalysis: true,
    })
    expect(analysisQuestionnaires()).toHaveLength(0)
  })
  it("resumes partial deletion and concurrent retries without duplicate events/counts", async () => {
    for (let i = 0; i < 251; i++)
      db.seed(`analysisQuestionnaires/${i}`, {
        ...metadata,
        clientId: `client-${i}`,
      })
    seedAuth()
    let batches = 0
    db.failCommit = (writes) =>
      writes.some((w) => w.kind === "delete") && ++batches === 2
    code(
      await call(api.withdrawParticipation, withdrawal),
      500,
      "WITHDRAWAL_CLEANUP_FAILED",
    )
    expect(analysisQuestionnaires()).toHaveLength(151)
    expect(
      required(db.data(getParticipationStateRef(owner.pseudonym).path))
        .deletedCount,
    ).toBe(100)
    db.failCommit = undefined
    const results = await Promise.all([
      call(api.withdrawParticipation, withdrawal),
      call(api.withdrawParticipation, withdrawal),
    ])
    for (const result of results)
      expect(result.body).toEqual({
        ok: true,
        deletedCount: 251,
        hasCompletedAnalysis: true,
      })
    expect(events()).toHaveLength(1)
    expect(Math.max(...db.writesPerCommit)).toBeLessThanOrEqual(302)
    expect(
      required(db.data(getParticipationStateRef(owner.pseudonym).path))
        .cleanupStatus,
    ).toBe("complete")
  })
  it("shrinks oversized deletion batches and persists the usable size", async () => {
    for (let i = 0; i < 30; i++)
      db.seed(`analysisQuestionnaires/large-${i}`, {
        ...metadata,
        largeAnswer: "x".repeat(1000),
      })
    db.deleteByteLimit = 5000
    expect((await call(api.withdrawParticipation, withdrawal)).body).toEqual({
      ok: true,
      deletedCount: 30,
      hasCompletedAnalysis: true,
    })
    expect(analysisQuestionnaires()).toHaveLength(0)
    expect(
      required(db.data(getParticipationStateRef(owner.pseudonym).path))
        .cleanupBatchSize,
    ).toBeLessThanOrEqual(3)
  })
  it("bounds each request and resumes after cleanup pending", async () => {
    for (let i = 0; i < 2001; i++)
      db.seed(`analysisQuestionnaires/${i}`, metadata)
    code(
      await call(api.withdrawParticipation, withdrawal),
      503,
      "WITHDRAWAL_CLEANUP_PENDING",
    )
    expect(analysisQuestionnaires()).toHaveLength(1)
    expect((await call(api.withdrawParticipation, withdrawal)).body).toEqual({
      ok: true,
      deletedCount: 2001,
      hasCompletedAnalysis: true,
    })
  })
  it("preserves other participants", async () => {
    db.seed("analysisQuestionnaires/other", { ...metadata, pseudonym: "other" })
    await call(api.withdrawParticipation, withdrawal)
    expect(db.data("analysisQuestionnaires/other")).toBeDefined()
  })
})

describe("confirmed reconsent and analysis attempts", () => {
  const start = {
    ...owner,
    analysisId: "attempt-1",
    outcome: "started",
    startedAtMs: now,
    documentGraphemeCounts: [12, 34],
  }
  const end = {
    ...owner,
    analysisId: "attempt-1",
    outcome: "completed",
    endedAtMs: now + 1000,
    durationMs: 1000,
  }
  it.each([
    "none",
    "started",
    "failed",
    "cancelled",
    "completed",
    "metadata",
    "submitted",
  ])(
    "retains the withdrawal decision after deleting %s evidence",
    async (history) => {
      if (["started", "failed", "cancelled", "completed"].includes(history)) {
        ok(await call(api.recordAnalysisAttempt, start))
        if (history !== "started")
          ok(
            await call(api.recordAnalysisAttempt, { ...end, outcome: history }),
          )
      }
      if (["metadata", "submitted"].includes(history)) {
        ok(await completeAndPresent())
        if (history === "submitted") ok(await call(api.submitSurvey, answer))
      }
      const expected =
        history === "started"
          ? null
          : ["completed", "metadata", "submitted"].includes(history)
      for (let retry = 0; retry < 2; retry++) {
        const result = await call(api.withdrawParticipation, withdrawal)
        ok(result)
        expect(result.body.hasCompletedAnalysis).toBe(expected)
        expect(analysisQuestionnaires()).toHaveLength(0)
      }
      expect(db.data("analysisAttempts/attempt-1")).toBeUndefined()
      expect(events()[0][1].hasCompletedAnalysis).toBe(expected)
      expect(
        db.data(getParticipationStateRef(owner.pseudonym).path)
          ?.hasCompletedAnalysis,
      ).toBe(expected)
    },
  )

  it("keeps invalid terminal evidence unknown after withdrawal cleanup", async () => {
    db.seed("analysisAttempts/invalid-outcome", {
      ...start,
      outcome: "unknown",
    })
    for (let retry = 0; retry < 2; retry++) {
      const result = await call(api.withdrawParticipation, withdrawal)
      ok(result)
      expect(result.body.hasCompletedAnalysis).toBeNull()
    }
    expect(db.data("analysisAttempts/invalid-outcome")).toBeUndefined()
  })

  it("retains completion across cleanup failure and ignores other participants", async () => {
    db.seed("analysisAttempts/other", {
      ...start,
      pseudonym: "other",
      outcome: "completed",
    })
    ok(await call(api.recordAnalysisAttempt, start))
    ok(await call(api.recordAnalysisAttempt, end))
    db.failCommit = (writes) => writes.some((write) => write.kind === "delete")
    code(
      await call(api.withdrawParticipation, withdrawal),
      500,
      "WITHDRAWAL_CLEANUP_FAILED",
    )
    db.failCommit = undefined
    expect(
      (await call(api.withdrawParticipation, withdrawal)).body
        .hasCompletedAnalysis,
    ).toBe(true)
    expect(db.data("analysisAttempts/other")).toBeDefined()
  })

  it("requires staff guidance when a withdrawal decision is missing", async () => {
    ok(await call(api.withdrawParticipation, withdrawal))
    const ref = getParticipationStateRef(owner.pseudonym)
    const { hasCompletedAnalysis: _, ...state } = required(db.data(ref.path))
    db.seed(ref.path, state)
    expect(
      (await call(api.withdrawParticipation, withdrawal)).body
        .hasCompletedAnalysis,
    ).toBeNull()
  })
  it.each(["test", "research", undefined])(
    "inherits %s purpose for attempts without allowing client overrides",
    async (purpose) => {
      db.seed("participationEvents/test-consent", {
        ...db.data("participationEvents/test-consent"),
        ...(purpose ? { dataPurpose: purpose } : {}),
      })
      code(
        await call(api.recordAnalysisAttempt, {
          ...start,
          dataPurpose: "research",
        }),
        400,
        "INVALID_REQUEST",
      )
      ok(await call(api.recordAnalysisAttempt, start))
      ok(await call(api.recordAnalysisAttempt, end))
      const stored = db.data("analysisAttempts/attempt-1")
      expect(stored?.dataPurpose).toBe(purpose ?? "unclassified")
      ok(await call(api.recordAnalysisAttempt, start))
      ok(await call(api.recordAnalysisAttempt, end))
      expect(db.data("analysisAttempts/attempt-1")).toEqual(stored)
    },
  )
  it("creates immutable start/end records and excludes them from survey counts", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    const original = db.data("analysisAttempts/attempt-1")
    const startedRecords = [...db.records]
    ok(await call(api.recordAnalysisAttempt, start))
    expect(db.data("analysisAttempts/attempt-1")).toEqual(original)
    expect([...db.records]).toEqual(startedRecords)
    ok(await call(api.recordAnalysisAttempt, end))
    const completed = db.data("analysisAttempts/attempt-1")
    const completedRecords = [...db.records]
    ok(await call(api.recordAnalysisAttempt, start))
    ok(await call(api.recordAnalysisAttempt, end))
    expect(db.data("analysisAttempts/attempt-1")).toEqual(completed)
    expect([...db.records]).toEqual(completedRecords)
    code(
      await call(api.recordAnalysisAttempt, { ...end, outcome: "failed" }),
      409,
      "ANALYSIS_EVENT_CONFLICT",
    )
    code(
      await call(api.recordAnalysisAttempt, {
        ...start,
        documentGraphemeCounts: [34, 12],
      }),
      409,
      "ANALYSIS_EVENT_CONFLICT",
    )
    expect(analysisQuestionnaires()).toHaveLength(0)
  })
  it.each(["different-participant", "renewed-consent"])(
    "rejects deleted analysis ID reuse by %s without changing retained history",
    async (scenario) => {
      ok(await call(api.recordAnalysisAttempt, start))
      ok(await call(api.recordAnalysisAttempt, end))
      ok(await call(api.withdrawParticipation, withdrawal))
      expect(db.data("analysisAttempts/attempt-1")).toBeUndefined()
      expect(db.data("analysisRuns/attempt-1")?.attemptDeletedAt).toBeDefined()
      const withdrawnState = required(
        db.data(getParticipationStateRef(owner.pseudonym).path),
      )
      const nextOwner = {
        ...owner,
        clientId: "next-client",
        consentId: "next-consent",
        pseudonym:
          scenario === "renewed-consent" ? owner.pseudonym : "next-participant",
      }
      const boundary =
        scenario === "renewed-consent" ? withdrawnState.lastWithdrawalId : null
      const generation =
        scenario === "renewed-consent" ? "next-generation" : null
      db.seed(getParticipationStateRef(nextOwner.pseudonym).path, {
        ...(scenario === "renewed-consent" ? withdrawnState : {}),
        pseudonym: nextOwner.pseudonym,
        status: "active",
        studyStatus: "follow-up",
        initialAnalysis: null,
        consentBoundaryId: boundary,
        studyGeneration: generation,
      })
      db.seed("participationEvents/next-consent", {
        ...nextOwner,
        eventType: "consent",
        authenticationVersion: 2,
        precedingWithdrawalId: boundary,
        studyGeneration: generation,
      })
      const retainedRecords = [...db.records]
      const nextStart = { ...start, ...nextOwner, startedAtMs: now + 1000 }
      code(
        await call(api.recordAnalysisAttempt, nextStart),
        409,
        "ANALYSIS_EVENT_CONFLICT",
      )
      expect([...db.records]).toEqual(retainedRecords)
      ok(
        await call(api.recordAnalysisAttempt, {
          ...nextStart,
          analysisId: "new-analysis",
        }),
      )
    },
  )
  it("requires start and rejects sensitive extra data", async () => {
    code(
      await call(api.recordAnalysisAttempt, end),
      409,
      "ANALYSIS_START_REQUIRED",
    )
    for (const extra of [
      { text: "body" },
      { name: "filename" },
      { result: "output" },
      { error: "raw" },
    ])
      code(
        await call(api.recordAnalysisAttempt, { ...start, ...extra }),
        400,
        "INVALID_REQUEST",
      )
    expect(db.data("analysisAttempts/attempt-1")).toBeUndefined()
  })
  it("serializes competing outcomes and removes attempts on withdrawal", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    const results = await Promise.all([
      call(api.recordAnalysisAttempt, end),
      call(api.recordAnalysisAttempt, { ...end, outcome: "cancelled" }),
    ])
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 409,
    ])
    expect(db.retries).toBeGreaterThan(0)
    expect(
      (await call(api.withdrawParticipation, withdrawal)).body.deletedCount,
    ).toBe(0)
    expect(db.data("analysisAttempts/attempt-1")).toBeUndefined()
    code(
      await call(api.recordAnalysisAttempt, start),
      403,
      "PARTICIPATION_WITHDRAWN",
    )
  })
  it("withdrawal wins an attempt write transaction race", async () => {
    db.beforeCommit = async () => {
      ok(await call(api.withdrawParticipation, withdrawal))
    }
    code(
      await call(api.recordAnalysisAttempt, start),
      403,
      "PARTICIPATION_WITHDRAWN",
    )
    expect(db.data("analysisAttempts/attempt-1")).toBeUndefined()
    expect(db.retries).toBeGreaterThan(0)
  })
})

it("read failures preserve machine codes without exposing SDK details", async () => {
  const original = db.collection.bind(db)
  vi.spyOn(db, "collection").mockImplementation((name) => {
    if (name === "information") throw new Error("private provider response")
    return original(name)
  })
  const result = await call(api.getInformation, {})
  code(result, 500, "INTERNAL_ERROR")
  expect(JSON.stringify(result.body)).not.toContain("private provider response")
})

describe("server-owned data purpose", () => {
  it.each(["research", "test", undefined])(
    "inherits %s from consent without altering exact retry receipts",
    async (purpose) => {
      db.seed("participationEvents/test-consent", {
        ...db.data("participationEvents/test-consent"),
        ...(purpose ? { dataPurpose: purpose } : {}),
      })
      ok(await completeAndPresent())
      ok(await call(api.submitSurvey, answer))
      const stored = db.data("analysisQuestionnaires/analysis-1")
      expect(stored?.dataPurpose).toBe(purpose ?? "unclassified")
      expect(stored?._integrity).toEqual({
        version: 1,
        metadata,
        answers: {
          questionnaire: answer.questionnaire,
          answers: answer.answers,
        },
      })
      ok(await completeAndPresent())
      ok(await call(api.submitSurvey, answer))
      expect(db.data("analysisQuestionnaires/analysis-1")).toEqual(stored)
      ok(await call(api.withdrawParticipation, withdrawal))
      expect(events()[0][1].dataPurpose).toBe(purpose ?? "unclassified")
      const access = [...db.records].filter(
        ([path, value]) =>
          path.startsWith("accessEvents/") &&
          value.eventType === "withdrawal_accepted",
      )
      expect(access).toHaveLength(1)
      expect(access[0][1].dataPurpose).toBe(purpose ?? "unclassified")
      const accepted = access
      ok(await call(api.withdrawParticipation, withdrawal))
      expect(
        [...db.records].filter(
          ([path, value]) =>
            path.startsWith("accessEvents/") &&
            value.eventType === "withdrawal_accepted",
        ),
      ).toEqual(accepted)
      expect(
        db.data(getParticipationStateRef(owner.pseudonym).path)?.dataPurpose,
      ).toBe(purpose ?? "unclassified")
    },
  )

  it("rejects caller-supplied purposes in metadata and answers, including nested fields", async () => {
    code(
      await call(api.recordAnalysisCompletion, {
        ...metadata,
        dataPurpose: "research",
      }),
      400,
      "INVALID_REQUEST",
    )
    ok(await completeAndPresent())
    code(
      await call(api.submitSurvey, { ...answer, dataPurpose: "research" }),
      400,
      "INVALID_REQUEST",
    )
    code(
      await call(api.submitSurvey, {
        ...answer,
        q3: { dataPurpose: "research" },
      }),
      400,
      "INVALID_REQUEST",
    )
    expect(
      db.data("analysisQuestionnaires/analysis-1")?.submittedAt,
    ).toBeUndefined()
  })
})

it("rejects retained history without its participation state", async () => {
  db.records.delete(getParticipationStateRef(owner.pseudonym).path)
  code(
    await call(api.recordAnalysisCompletion, metadata),
    409,
    "PARTICIPATION_STATE_INVALID",
  )
  expect(analysisQuestionnaires()).toHaveLength(0)
})

describe("durable operational history", () => {
  const start = {
    ...owner,
    analysisId: "history-run",
    outcome: "started",
    startedAtMs: now,
    documentGraphemeCounts: [123],
  }
  const end = {
    ...owner,
    analysisId: "history-run",
    outcome: "completed",
    endedAtMs: now + 1000,
    durationMs: 1000,
  }
  it("accepts late terminal receipts after physical deletion without restoring measurements or permission", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    ok(await call(api.withdrawParticipation, withdrawal))
    const stateRef = getParticipationStateRef(owner.pseudonym)
    const withdrawn = db.data(stateRef.path)
    expect(db.data("analysisAttempts/history-run")).toBeUndefined()
    ok(await call(api.recordAnalysisAttempt, end))
    const retained = db.data("analysisRuns/history-run")
    expect(retained).toMatchObject({
      outcome: "completed",
      startedAtMs: now,
      endedAtMs: now + 1000,
    })
    expect(retained?.attemptDeletedAt).toBeDefined()
    expect(retained).not.toHaveProperty("durationMs")
    expect(retained).not.toHaveProperty("documentGraphemeCounts")
    expect(db.data(stateRef.path)).toEqual(withdrawn)
    expect(db.data("analysisAttempts/history-run")).toBeUndefined()
    vi.mocked(Date.now).mockReturnValue(now + 3000)
    ok(await call(api.recordAnalysisAttempt, end))
    expect(db.data("analysisRuns/history-run")).toEqual(retained)
    code(
      await call(api.recordAnalysisAttempt, { ...end, outcome: "failed" }),
      409,
      "ANALYSIS_EVENT_CONFLICT",
    )
    code(
      await call(api.recordAnalysisAttempt, { ...end, clientId: "other" }),
      409,
      "OWNER_CONFLICT",
    )
    code(
      await call(api.recordAnalysisAttempt, { ...end, analysisId: "unknown" }),
      409,
      "ANALYSIS_START_REQUIRED",
    )
  })
  it("does not release a replacement generation's claim when an older run ends", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    const stateRef = getParticipationStateRef(owner.pseudonym)
    const replacement = {
      ...db.data(stateRef.path),
      studyGeneration: "new-generation",
      initialAnalysis: {
        analysisId: "replacement",
        clientId: "new-client",
        consentId: "new-consent",
        serverId: owner.serverId,
        presented: false,
      },
    }
    db.seed(stateRef.path, replacement)
    ok(await call(api.recordAnalysisAttempt, { ...end, outcome: "cancelled" }))
    expect(db.data(stateRef.path)).toEqual(replacement)
    expect(db.data("analysisRuns/history-run")?.outcome).toBe("cancelled")
    expect(db.data("analysisAttempts/history-run")?.outcome).toBe("started")
  })
  it("retains original submission and initial eligibility facts after answer deletion", async () => {
    ok(await completeAndPresent())
    ok(await call(api.submitSurvey, answer))
    const accepted = db.data("analysisRuns/analysis-1")
    const stateRef = getParticipationStateRef(owner.pseudonym)
    const initialAccepted = db.data(stateRef.path)?.initialSurveyAcceptedAt
    ok(await call(api.withdrawParticipation, withdrawal))
    const retained = db.data("analysisRuns/analysis-1")
    expect(retained?.submittedAt).toEqual(accepted?.submittedAt)
    expect(retained?.presentationRecordedAt).toEqual(
      accepted?.presentationRecordedAt,
    )
    expect(db.data(stateRef.path)?.initialSurveyAcceptedAt).toEqual(
      initialAccepted,
    )
    expect(db.data("analysisQuestionnaires/analysis-1")).toBeUndefined()
    expect(retained?.questionnaireDeletedAt).toBeDefined()
    expect(retained?.attemptDeletedAt).toBeDefined()
    const audit = JSON.stringify(
      [...db.records].filter(
        ([path]) =>
          path.startsWith("analysisRuns/") || path.startsWith("accessEvents/"),
      ),
    )
    expect(audit).not.toMatch(
      /durationMs|processingDurationSeconds|documentGrapheme|model-1|"answers"|encryptedEmail|_integrity/,
    )
  })
  it("records output loss on a started run without inventing completion", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    const loss = {
      ...owner,
      analysisId: start.analysisId,
      outcome: "unavailable",
      reason: "result_unavailable",
    }
    ok(await call(api.recordAnalysisAttempt, loss))
    const retained = db.data("analysisRuns/history-run")
    expect(retained?.outcome).toBe("started")
    expect(retained?.resultUnavailableAt).toBeDefined()
    expect(retained?.outcomeReceivedAt).toBeUndefined()
    vi.mocked(Date.now).mockReturnValue(now + 4000)
    ok(await call(api.recordAnalysisAttempt, loss))
    expect(db.data("analysisRuns/history-run")).toEqual(retained)
  })
})

describe("operational outcome redelivery", () => {
  const start = {
    ...owner,
    analysisId: "analysis-1",
    outcome: "started",
    startedAtMs: now - 1000,
    documentGraphemeCounts: [10],
  }
  const outcome = {
    ...owner,
    analysisId: "analysis-1",
    outcome: "completed",
    endedAtMs: now,
  }
  it("allows audit-first delivery without research or eligibility writes, then accepts the real duration once", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    const beforeAttempt = db.data("analysisAttempts/analysis-1")
    const beforeState = db.data(getParticipationStateRef(owner.pseudonym).path)
    ok(await call(api.recordAnalysisOutcome, outcome))
    expect(db.data("analysisAttempts/analysis-1")).toEqual(beforeAttempt)
    expect(db.data(getParticipationStateRef(owner.pseudonym).path)).toEqual(
      beforeState,
    )
    const firstReceipt = db.data("analysisRuns/analysis-1")?.outcomeReceivedAt
    const eventCount = [...db.records].filter(([path]) =>
      path.startsWith("accessEvents/"),
    ).length
    expect(db.data("analysisRuns/analysis-1")?.durationMs).toBeUndefined()
    ok(await call(api.recordAnalysisAttempt, { ...outcome, durationMs: 1000 }))
    expect(db.data("analysisAttempts/analysis-1")?.durationMs).toBe(1000)
    expect(db.data("analysisRuns/analysis-1")?.outcomeReceivedAt).toEqual(
      firstReceipt,
    )
    expect(
      [...db.records].filter(([path]) => path.startsWith("accessEvents/")),
    ).toHaveLength(eventCount)
    const snapshot = [...db.records]
    ok(await call(api.recordAnalysisOutcome, outcome))
    expect([...db.records]).toEqual(snapshot)
    code(
      await call(api.recordAnalysisOutcome, { ...outcome, outcome: "failed" }),
      409,
      "ANALYSIS_EVENT_CONFLICT",
    )
    code(
      await call(api.recordAnalysisAttempt, {
        ...outcome,
        endedAtMs: now + 1,
        durationMs: 1001,
      }),
      409,
      "ANALYSIS_EVENT_CONFLICT",
    )
    expect([...db.records]).toEqual(snapshot)
  })
  it("acknowledges normal-first delivery without rewriting any receipt", async () => {
    await prepareCompletedAttempt()
    const snapshot = [...db.records]
    ok(await call(api.recordAnalysisOutcome, outcome))
    expect([...db.records]).toEqual(snapshot)
  })
  it("preserves an audit-first terminal receipt when lost output is recorded", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    ok(await call(api.recordAnalysisOutcome, outcome))
    const terminal = db.data("analysisRuns/analysis-1")
    const loss = {
      ...owner,
      analysisId: "analysis-1",
      outcome: "unavailable",
      reason: "result_unavailable",
    }
    ok(await call(api.recordAnalysisAttempt, loss))
    const retained = db.data("analysisRuns/analysis-1")
    expect(retained).toMatchObject({
      ...terminal,
      outcome: "completed",
      endedAtMs: now,
      resultUnavailableAt: expect.any(Timestamp),
    })
    expect(db.data("analysisAttempts/analysis-1")?.outcome).toBe("started")
    const snapshot = [...db.records]
    ok(await call(api.recordAnalysisOutcome, outcome))
    ok(await call(api.recordAnalysisAttempt, loss))
    expect([...db.records]).toEqual(snapshot)
    ok(await call(api.recordAnalysisAttempt, { ...outcome, durationMs: 1000 }))
    expect(db.data("analysisRuns/analysis-1")).toEqual(retained)
  })
  it("retains only the late operational outcome after physical withdrawal cleanup", async () => {
    ok(await call(api.recordAnalysisAttempt, start))
    ok(await call(api.withdrawParticipation, withdrawal))
    expect(db.data("analysisAttempts/analysis-1")).toBeUndefined()
    const beforeState = db.data(getParticipationStateRef(owner.pseudonym).path)
    ok(await call(api.recordAnalysisOutcome, outcome))
    expect(db.data("analysisAttempts/analysis-1")).toBeUndefined()
    expect(analysisQuestionnaires()).toEqual([])
    expect(db.data(getParticipationStateRef(owner.pseudonym).path)).toEqual(
      beforeState,
    )
    expect(db.data("analysisRuns/analysis-1")).toMatchObject({
      outcome: "completed",
      endedAtMs: now,
    })
    expect(JSON.stringify(db.data("analysisRuns/analysis-1"))).not.toMatch(
      /durationMs|documentGrapheme|model|answers/,
    )
    const retired = [...db.records.values()].find(
      (record) => record.eventType === "authentication_retired",
    )
    expect(retired?.retiredAt).toBeInstanceOf(Timestamp)
    expect(retired?.withdrawalId).toEqual(
      db.data(getParticipationStateRef(owner.pseudonym).path)?.lastWithdrawalId,
    )
  })
  it("rejects unacknowledged starts, foreign owners and research-bearing requests", async () => {
    code(
      await call(api.recordAnalysisOutcome, outcome),
      409,
      "ANALYSIS_START_REQUIRED",
    )
    ok(await call(api.recordAnalysisAttempt, start))
    for (const extra of [
      { durationMs: 1000 },
      { documentGraphemeCounts: [10] },
      { model: "model" },
      { answers: {} },
    ])
      expect(
        (await call(api.recordAnalysisOutcome, { ...outcome, ...extra }))
          .statusCode,
      ).toBe(400)
    expect(
      (await call(api.recordAnalysisOutcome, { ...outcome, clientId: "other" }))
        .statusCode,
    ).toBe(409)
    code(
      await call(api.recordAnalysisOutcome, {
        ...outcome,
        endedAtMs: now - 1001,
      }),
      409,
      "ANALYSIS_EVENT_CONFLICT",
    )
    expect(db.data("analysisRuns/analysis-1")?.outcome).toBe("started")
  })
})
