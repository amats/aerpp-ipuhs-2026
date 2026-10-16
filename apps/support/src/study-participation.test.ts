import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import type { Firestore } from "@google-cloud/firestore"
import type { Request, Response } from "express"
import { beforeEach, expect, it, vi } from "vitest"
import { MemoryFirestore, Timestamp } from "../test-support/firestore.js"

const mock = vi.hoisted(() => ({ db: undefined as unknown }))
vi.mock("./storage.js", () => ({
  getFirestore: () => mock.db,
  getParticipantRepository: () =>
    createParticipantRepository(mock.db as Firestore),
  Timestamp,
  FieldValue: { serverTimestamp: () => Timestamp.now() },
}))
vi.mock("@google-cloud/firestore", () => ({
  Timestamp,
  FieldValue: { serverTimestamp: () => Timestamp.now() },
}))

import * as api from "./participant-handlers.js"

const first = {
  pseudonym: "study-pid",
  clientId: "browser-A",
  serverId: "server-1",
  consentId: "consent-A",
}
const second = { ...first, clientId: "browser-B", consentId: "consent-B" }
let db: MemoryFirestore
beforeEach(() => {
  db = new MemoryFirestore()
  mock.db = db
  const repository = createParticipantRepository(db as unknown as Firestore)
  db.seed(repository.participationState(first.pseudonym).path, {
    pseudonym: first.pseudonym,
    status: "active",
    consentBoundaryId: null,
  })
  for (const owner of [first, second]) {
    db.seed(`participationEvents/${owner.consentId}`, {
      ...owner,
      eventType: "consent",
      precedingWithdrawalId: null,
      authenticationVersion: 2,
    })
    db.seed(`emailConfirmations/${owner.consentId}`, {
      ...owner,
      status: "completed",
      authenticationVersion: 2,
    })
  }
})
function currentStudyState() {
  return db.data(
    createParticipantRepository(db as unknown as Firestore).participationState(
      first.pseudonym,
    ).path,
  )
}
async function call(
  handler: (req: Request, res: Response) => unknown,
  body: unknown,
) {
  let statusCode = 200
  let value: Record<string, unknown> = {}
  const response = {
    status(code: number) {
      statusCode = code
      return this
    },
    json(body: Record<string, unknown>) {
      value = body
      return this
    },
  }
  await handler({ body } as Request, response as unknown as Response)
  return { statusCode, ...value }
}
function start(owner = first, id = "analysis-A") {
  return {
    ...owner,
    analysisId: id,
    outcome: "started",
    startedAtMs: 1000,
    documentGraphemeCounts: [100],
  }
}
const terminal = {
  ...first,
  analysisId: "analysis-A",
  outcome: "completed",
  endedAtMs: 2000,
  durationMs: 1000,
}
const presentation = {
  ...first,
  analysisId: "analysis-A",
  outcome: "presented",
}
const metadata = {
  ...first,
  analysisId: "analysis-A",
  analysisWorkspaceVersion: "1.0.0",
  documentCount: 1,
}
const survey = {
  ...first,
  analysisId: "analysis-A",
  questionnaire: {
    kind: "initial",
    definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
  },
  answers: { q1: "answer" },
}

it("atomically acquires only one browser for simultaneous initial starts", async () => {
  const outcomes = await Promise.all([
    call(api.recordAnalysisAttempt, start()),
    call(api.recordAnalysisAttempt, start(second, "analysis-B")),
  ])
  expect(outcomes.map((outcome) => outcome.statusCode).sort()).toEqual([
    200, 409,
  ])
  expect(db.retries).toBeGreaterThan(0)
  expect(
    [...db.records.keys()].filter((key) => key.startsWith("analysisAttempts/")),
  ).toHaveLength(1)
})
it("blocks other browsers and reanalysis until presentation and initial survey acceptance", async () => {
  expect(await call(api.recordAnalysisAttempt, start())).toMatchObject({
    statusCode: 200,
    questionnaireKind: "initial",
  })
  expect(await call(api.verifyAuthentication, second)).toMatchObject({
    statusCode: 409,
    code: "INITIAL_BROWSER_REQUIRED",
  })
  expect((await call(api.recordAnalysisAttempt, terminal)).statusCode).toBe(200)
  expect((await call(api.recordAnalysisCompletion, metadata)).statusCode).toBe(
    200,
  )
  expect(await call(api.submitSurvey, survey)).toMatchObject({
    statusCode: 409,
    code: "RESULT_PRESENTATION_REQUIRED",
  })
  expect((await call(api.recordAnalysisAttempt, presentation)).statusCode).toBe(
    200,
  )
  const firstTimestamp = db.data(
    "analysisAttempts/analysis-A",
  )?.presentationRecordedAt
  expect((await call(api.recordAnalysisAttempt, presentation)).statusCode).toBe(
    200,
  )
  expect(
    db.data("analysisAttempts/analysis-A")?.presentationRecordedAt,
  ).toEqual(firstTimestamp)
  expect(
    await call(api.recordAnalysisAttempt, start(first, "analysis-new")),
  ).toMatchObject({ statusCode: 409, code: "INITIAL_ANALYSIS_LOCKED" })
  expect((await call(api.submitSurvey, survey)).statusCode).toBe(200)
  const accepted = db.data("analysisQuestionnaires/analysis-A")?.submittedAt
  expect((await call(api.submitSurvey, survey)).statusCode).toBe(200)
  expect(db.data("analysisQuestionnaires/analysis-A")?.submittedAt).toEqual(
    accepted,
  )
  expect(await call(api.verifyAuthentication, second)).toMatchObject({
    statusCode: 200,
    questionnaireKind: "follow-up",
  })
  const acceptedState = currentStudyState()
  const originalAttempt = db.data("analysisAttempts/analysis-A")
  expect(await call(api.recordAnalysisAttempt, start())).toMatchObject({
    statusCode: 200,
    questionnaireKind: "initial",
  })
  expect(currentStudyState()).toEqual(acceptedState)
  expect(db.data("analysisAttempts/analysis-A")).toEqual(originalAttempt)
  const parallel = await Promise.all([
    call(api.recordAnalysisAttempt, start(first, "follow-A")),
    call(api.recordAnalysisAttempt, start(second, "follow-B")),
  ])
  for (const outcome of parallel)
    expect(outcome).toMatchObject({
      statusCode: 200,
      questionnaireKind: "follow-up",
    })
  expect(db.data("analysisAttempts/follow-A")?.questionnaireKind).toBe(
    "follow-up",
  )
  expect(db.data("analysisAttempts/follow-B")?.questionnaireKind).toBe(
    "follow-up",
  )
})
it.each(["failed", "cancelled"])(
  "releases the initial browser only after a recorded %s outcome",
  async (outcome) => {
    expect((await call(api.recordAnalysisAttempt, start())).statusCode).toBe(
      200,
    )
    expect(
      (await call(api.recordAnalysisAttempt, { ...terminal, outcome }))
        .statusCode,
    ).toBe(200)
    expect(
      (await call(api.recordAnalysisAttempt, start(second, "analysis-B")))
        .statusCode,
    ).toBe(200)
    // Late exact terminal retries remain historical and cannot disturb a newer attempt.
    expect(
      (await call(api.recordAnalysisAttempt, { ...terminal, outcome }))
        .statusCode,
    ).toBe(200)
  },
)
it("retains unknown work and participant history when a browser session disappears", async () => {
  expect((await call(api.recordAnalysisAttempt, start())).statusCode).toBe(200)
  expect(
    await call(api.recordAnalysisAttempt, start(second, "replacement")),
  ).toMatchObject({ statusCode: 409, code: "INITIAL_BROWSER_REQUIRED" })
  expect(await call(api.recordAnalysisCompletion, metadata)).toMatchObject({
    statusCode: 409,
    code: "ANALYSIS_COMPLETION_NOT_FOUND",
  })
  expect(db.data("analysisAttempts/analysis-A")?.outcome).toBe("started")
})

const unavailable = {
  ...first,
  analysisId: "analysis-A",
  outcome: "unavailable",
  reason: "result_unavailable",
}
it.each(["before-metadata", "after-metadata", "terminal-ack-loss"])(
  "recovers lost unpresented initial output without replacing research facts (%s)",
  async (phase) => {
    expect((await call(api.recordAnalysisAttempt, start())).statusCode).toBe(
      200,
    )
    if (phase !== "terminal-ack-loss")
      expect((await call(api.recordAnalysisAttempt, terminal)).statusCode).toBe(
        200,
      )
    if (phase === "after-metadata")
      expect(
        (await call(api.recordAnalysisCompletion, metadata)).statusCode,
      ).toBe(200)
    const original = db.data("analysisAttempts/analysis-A")
    expect(
      (await call(api.recordAnalysisAttempt, unavailable)).statusCode,
    ).toBe(200)
    const recovered = db.data("analysisAttempts/analysis-A")
    if (!original) throw new Error("Expected original analysis record")
    expect(recovered).toMatchObject(original)
    expect(currentStudyState()?.initialAnalysis).toBeNull()
    expect(recovered?.resultUnavailableAt).toBeDefined()
    expect(recovered?.unavailability).toEqual(unavailable)
    expect(
      (await call(api.recordAnalysisAttempt, start(first, "replacement")))
        .statusCode,
    ).toBe(200)
    const claim = currentStudyState()?.initialAnalysis
    expect(claim).toMatchObject({ analysisId: "replacement", presented: false })
    const timestamp = recovered?.resultUnavailableAt
    expect(
      (await call(api.recordAnalysisAttempt, unavailable)).statusCode,
    ).toBe(200)
    expect(db.data("analysisAttempts/analysis-A")?.resultUnavailableAt).toEqual(
      timestamp,
    )
    expect(currentStudyState()?.initialAnalysis).toEqual(claim)
    expect((await call(api.recordAnalysisAttempt, terminal)).statusCode).toBe(
      200,
    )
    expect(currentStudyState()?.initialAnalysis).toEqual(claim)
    expect(await call(api.recordAnalysisCompletion, metadata)).toMatchObject({
      statusCode: 409,
      code: "RESULT_UNAVAILABLE",
    })
    expect(await call(api.recordAnalysisAttempt, presentation)).toMatchObject({
      statusCode: 409,
      code: "RESULT_UNAVAILABLE",
    })
    expect(await call(api.recordAnalysisAttempt, start())).toMatchObject({
      statusCode: 409,
      code: "RESULT_UNAVAILABLE",
    })
  },
)
it.each(["loss-first", "presentation-first"])(
  "serializes initial presentation and loss recovery (%s)",
  async (order) => {
    await call(api.recordAnalysisAttempt, start())
    await call(api.recordAnalysisAttempt, terminal)
    await call(api.recordAnalysisCompletion, metadata)
    const events =
      order === "loss-first"
        ? [unavailable, presentation]
        : [presentation, unavailable]
    const outcomes = await Promise.all(
      events.map((event) => call(api.recordAnalysisAttempt, event)),
    )
    expect(outcomes.map((result) => result.statusCode).sort()).toEqual([
      200, 409,
    ])
    const attempt = db.data("analysisAttempts/analysis-A")
    expect(Boolean(attempt?.resultUnavailableAt)).not.toBe(
      Boolean(attempt?.presentationRecordedAt),
    )
    if (attempt?.presentationRecordedAt)
      expect(currentStudyState()?.initialAnalysis).toMatchObject({
        analysisId: "analysis-A",
        presented: true,
      })
    else expect(currentStudyState()?.initialAnalysis).toBeNull()
  },
)

it("protects the first presented initial result from loss recovery or replacement", async () => {
  await call(api.recordAnalysisAttempt, start())
  await call(api.recordAnalysisAttempt, terminal)
  await call(api.recordAnalysisCompletion, metadata)
  await call(api.recordAnalysisAttempt, presentation)
  expect(await call(api.recordAnalysisAttempt, unavailable)).toMatchObject({
    statusCode: 409,
    code: "RESULT_ALREADY_PRESENTED",
  })
  expect(
    (await call(api.recordAnalysisAttempt, start(first, "replacement")))
      .statusCode,
  ).toBe(409)
  expect((await call(api.submitSurvey, survey)).statusCode).toBe(200)
})
it("rejects recovery with a different owner or without an acknowledged start", async () => {
  expect((await call(api.recordAnalysisAttempt, unavailable)).statusCode).toBe(
    409,
  )
  await call(api.recordAnalysisAttempt, start())
  expect(
    (await call(api.recordAnalysisAttempt, { ...unavailable, ...second }))
      .statusCode,
  ).toBe(409)
  expect(
    db.data("analysisAttempts/analysis-A")?.resultUnavailableAt,
  ).toBeUndefined()
})

it("rejects missing authentication proof without changing confirmed consent", async () => {
  const consentPath = `participationEvents/${first.consentId}`
  const consent = db.data(consentPath)
  db.records.delete(`emailConfirmations/${first.consentId}`)
  expect(await call(api.verifyAuthentication, first)).toMatchObject({
    statusCode: 401,
    code: "AUTHENTICATION_INVALID",
  })
  expect(db.data(consentPath)).toEqual(consent)
})

it("permits follow-up presentation loss and post-initial-survey loss without replacing accepted research facts", async () => {
  await call(api.recordAnalysisAttempt, start())
  await call(api.recordAnalysisAttempt, terminal)
  await call(api.recordAnalysisCompletion, metadata)
  await call(api.recordAnalysisAttempt, presentation)
  await call(api.submitSurvey, survey)
  const accepted = db.data("analysisQuestionnaires/analysis-A")
  expect((await call(api.recordAnalysisAttempt, unavailable)).statusCode).toBe(
    200,
  )
  expect(db.data("analysisQuestionnaires/analysis-A")).toMatchObject(
    accepted ?? {},
  )
  const analysisId = "follow-up-analysis"
  expect(
    (await call(api.recordAnalysisAttempt, start(first, analysisId)))
      .statusCode,
  ).toBe(200)
  await call(api.recordAnalysisAttempt, { ...terminal, analysisId })
  await call(api.recordAnalysisCompletion, { ...metadata, analysisId })
  await call(api.recordAnalysisAttempt, { ...presentation, analysisId })
  const original = db.data(`analysisQuestionnaires/${analysisId}`)
  expect(
    (await call(api.recordAnalysisAttempt, { ...unavailable, analysisId }))
      .statusCode,
  ).toBe(200)
  expect(db.data(`analysisQuestionnaires/${analysisId}`)).toMatchObject(
    original ?? {},
  )
  expect(currentStudyState()?.studyStatus).toBe("follow-up")
  expect(
    (await call(api.recordAnalysisAttempt, start(first, "next-follow-up")))
      .statusCode,
  ).toBe(200)
})
