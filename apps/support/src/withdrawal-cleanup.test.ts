import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import type { Firestore } from "@google-cloud/firestore"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
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
vi.mock("./storage.js", () => ({
  getFirestore: () => mock.db,
  getParticipantRepository: () =>
    createParticipantRepository(mock.db as Firestore),
  Timestamp,
  FieldValue: { serverTimestamp: () => Timestamp.now() },
}))
vi.mock("./logger.js", () => ({ logger: mock }))

import {
  deleteWithdrawnParticipantData,
  getParticipationStateRef,
} from "./participant-state.js"
import { sweepWithdrawalCleanup } from "./withdrawal-cleanup.js"

let db: MemoryFirestore
beforeEach(() => {
  db = new MemoryFirestore()
  mock.db = db
  vi.clearAllMocks()
})
afterEach(() => vi.restoreAllMocks())
function seed(pseudonym = "participant", withdrawalId = "withdrawal-1") {
  const ref = getParticipationStateRef(pseudonym)
  db.seed(ref.path, {
    pseudonym,
    status: "withdrawn",
    lastWithdrawalId: withdrawalId,
    cleanupStatus: "pending",
    deletedCount: 0,
  })
  db.seed(`analysisQuestionnaires/${pseudonym}`, { pseudonym })
  db.seed(`analysisAttempts/${pseudonym}`, { pseudonym })
  db.seed(`emailConfirmations/${pseudonym}`, { pseudonym })
  db.seed(`participationEvents/${withdrawalId}`, {
    pseudonym,
    eventType: "withdrawal",
  })
  return ref
}

it("atomically retains operational runs across failed and concurrent cleanup retries", async () => {
  const ref = seed()
  const owner = {
    pseudonym: "participant",
    serverId: "server-1",
    clientId: "client-1",
    consentId: "consent-1",
    dataPurpose: "research",
  }
  const research = {
    documentCount: 2,
    documentGraphemeCounts: [100, 200],
    documentGraphemeCount: 300,
    resultGraphemeCount: 50,
    modelName: "synthetic-model",
    durationMs: 1000,
    processingDurationSeconds: 1,
    answers: { q1: "synthetic-answer" },
    _integrity: { answers: { q1: "synthetic-answer" } },
    unexpected: "must-not-be-retained",
  }
  const timestamps = {
    receivedAt: Timestamp.fromMillis(1100),
    outcomeReceivedAt: Timestamp.fromMillis(2100),
    presentationRecordedAt: Timestamp.fromMillis(2200),
    submittedAt: Timestamp.fromMillis(3000),
  }
  db.seed("analysisAttempts/participant", {
    ...owner,
    ...research,
    ...timestamps,
    startedAtMs: 1000,
    endedAtMs: 2000,
    start: { ...research },
    end: { ...research },
  })
  db.seed("analysisQuestionnaires/participant", {
    ...owner,
    ...research,
    presentationRecordedAt: timestamps.presentationRecordedAt,
    submittedAt: timestamps.submittedAt,
    createdAt: Timestamp.fromMillis(2150),
  })
  db.failCommit = (writes) => writes.some((write) => write.kind === "delete")
  expect(await sweepWithdrawalCleanup()).toMatchObject({ failed: 1 })
  expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
  expect(db.data("analysisRuns/participant")).toBeUndefined()
  db.failCommit = (writes) =>
    writes.some((write) => write.ref.path === "analysisAttempts/participant")
  expect(await sweepWithdrawalCleanup()).toMatchObject({ failed: 1 })
  expect(db.data("analysisQuestionnaires/participant")).toBeUndefined()
  expect(db.data("analysisAttempts/participant")).toBeDefined()
  const questionnaireRun = db.data("analysisRuns/participant")
  expect(questionnaireRun).toMatchObject({
    ...owner,
    analysisId: "participant",
    presentationRecordedAt: timestamps.presentationRecordedAt,
    submittedAt: timestamps.submittedAt,
    createdAt: Timestamp.fromMillis(2150),
    researchWithdrawalId: "withdrawal-1",
  })
  expect(questionnaireRun?.questionnaireDeletedAt).toBeInstanceOf(Timestamp)
  expect(JSON.stringify(questionnaireRun)).not.toMatch(
    /synthetic-answer|synthetic-model|durationMs|documentCount|unexpected|_integrity/,
  )
  db.failCommit = undefined
  await Promise.all([
    sweepWithdrawalCleanup(),
    deleteWithdrawnParticipantData("participant", "withdrawal-1"),
  ])
  const retained = db.data("analysisRuns/participant")
  expect(retained).toMatchObject({
    ...questionnaireRun,
    startedAtMs: 1000,
    endedAtMs: 2000,
    receivedAt: timestamps.receivedAt,
    outcomeReceivedAt: timestamps.outcomeReceivedAt,
  })
  expect(retained?.attemptDeletedAt).toBeInstanceOf(Timestamp)
  expect(JSON.stringify(retained)).not.toMatch(
    /synthetic-answer|synthetic-model|durationMs|documentCount|unexpected|_integrity/,
  )
  const events = await createParticipantRepository(db as unknown as Firestore)
    .participationEventsFor("participant")
    .get()
  expect(events.docs.map((doc) => doc.data().eventType).sort()).toEqual([
    "authentication_retired",
    "withdrawal",
  ])
  expect(db.data("analysisAttempts/participant")).toBeUndefined()
  expect(db.data(ref.path)).toMatchObject({
    cleanupStatus: "complete",
    deletedCount: 1,
  })
  await deleteWithdrawnParticipantData("participant", "withdrawal-1")
  expect(db.data("analysisRuns/participant")).toEqual(retained)
})

it("keeps missing observations absent instead of inventing activity times", async () => {
  seed()
  db.seed("analysisAttempts/participant", {
    pseudonym: "participant",
    startedAtMs: 1000,
    endedAtMs: null,
    submittedAt: "invalid-time",
    durationMs: 500,
  })
  await deleteWithdrawnParticipantData("participant", "withdrawal-1")
  const run = db.data("analysisRuns/participant")
  expect(run?.startedAtMs).toBe(1000)
  expect(run?.endedAtMs).toBeNull()
  expect(run).not.toHaveProperty("presentationRecordedAt")
  expect(run).not.toHaveProperty("durationMs")
})

it("resumes committed withdrawal without any browser or consent request", async () => {
  const ref = seed()
  const consent = {
    pseudonym: "participant",
    eventType: "consent",
    consentConfirmedAt: Timestamp.now(),
    precedingWithdrawalId: null,
  }
  db.seed("participationEvents/confirmed-consent", consent)
  const withdrawal = db.data("participationEvents/withdrawal-1")
  db.failCommit = (writes) => writes.some((write) => write.kind === "delete")
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    failed: 1,
    completed: 0,
  })
  expect(db.data(ref.path)?.cleanupStatus).toBe("pending")
  expect(db.data("participationEvents/confirmed-consent")).toEqual(consent)
  expect(db.data("participationEvents/withdrawal-1")).toEqual(withdrawal)
  db.failCommit = undefined
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    scanned: 1,
    completed: 1,
  })
  expect(db.data(ref.path)).toMatchObject({
    cleanupStatus: "complete",
    deletedCount: 1,
  })
  for (const collection of [
    "analysisQuestionnaires",
    "analysisAttempts",
    "emailConfirmations",
  ])
    expect(db.data(`${collection}/participant`)).toBeUndefined()
  expect(db.data("participationEvents/confirmed-consent")).toEqual(consent)
  expect(db.data("participationEvents/withdrawal-1")).toEqual(withdrawal)
  expect(await sweepWithdrawalCleanup()).toMatchObject({ scanned: 0 })
})

it.each(["active", "withdrawn"])(
  "fences old work after participation becomes %s with newer history",
  async (status) => {
    const ref = seed()
    db.seed(ref.path, {
      ...db.data(ref.path),
      status,
      lastWithdrawalId: "withdrawal-2",
    })
    await expect(
      deleteWithdrawnParticipantData("participant", "withdrawal-1"),
    ).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
    expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
  },
)

it("rechecks the captured history after a transaction conflict", async () => {
  const ref = seed()
  db.beforeCommit = async () => {
    db.seed(ref.path, {
      ...db.data(ref.path),
      lastWithdrawalId: "withdrawal-2",
    })
  }
  expect(await sweepWithdrawalCleanup()).toMatchObject({ superseded: 1 })
  expect(db.retries).toBeGreaterThan(0)
  expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
})

it("counts each deletion once with overlapping workers and manual cleanup", async () => {
  const ref = seed()
  await Promise.all([
    sweepWithdrawalCleanup(),
    sweepWithdrawalCleanup(),
    deleteWithdrawnParticipantData("participant", "withdrawal-1"),
  ])
  expect(db.data(ref.path)).toMatchObject({
    deletedCount: 1,
    cleanupStatus: "complete",
  })
  expect(mock.info).not.toHaveBeenCalled()
  const job = db.data("withdrawalJobs/withdrawal-1")
  expect(job).toMatchObject({ status: "complete", deletedCount: 1 })
  db.seed("emailConfirmations/new-consent", { pseudonym: "participant" })
  await deleteWithdrawnParticipantData("participant", "withdrawal-1")
  expect(db.data("withdrawalJobs/withdrawal-1")).toEqual(job)
  expect(db.data("emailConfirmations/new-consent")).toBeDefined()
})

it("retains bounded progress for the next invocation", async () => {
  const ref = seed()
  for (let i = 0; i < 2000; i++)
    db.seed(`analysisQuestionnaires/large-${i}`, { pseudonym: "participant" })
  expect(await sweepWithdrawalCleanup()).toMatchObject({ pending: 1 })
  expect(db.data(ref.path)).toMatchObject({
    cleanupStatus: "pending",
    deletedCount: 2000,
  })
  expect(await sweepWithdrawalCleanup()).toMatchObject({ completed: 1 })
  expect(db.data(ref.path)).toMatchObject({
    cleanupStatus: "complete",
    deletedCount: 2001,
  })
})

it("shrinks the actual persisted batch size without repeating the same oversized batch", async () => {
  const ref = seed()
  db.seed(ref.path, { ...db.data(ref.path), cleanupBatchSize: 2 })
  for (const id of ["a", "b"])
    db.seed(`analysisQuestionnaires/${id}`, {
      pseudonym: "participant",
      answer: "x".repeat(1000),
    })
  db.deleteByteLimit = 1500
  const batches: number[] = []
  const recordBatch = async (
    writes: { kind: string; ref: { path: string } }[],
  ) => {
    const deleted = writes.filter(
      (write) =>
        write.kind === "delete" &&
        write.ref.path.startsWith("analysisQuestionnaires/"),
    )
    if (deleted.length) batches.push(deleted.length)
    db.beforeCommit = recordBatch
  }
  db.beforeCommit = recordBatch
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    completed: 1,
    failed: 0,
  })
  expect(batches).toEqual([2, 1, 1, 1])
  expect(db.data(ref.path)).toMatchObject({
    cleanupStatus: "complete",
    cleanupBatchSize: 1,
    deletedCount: 3,
  })
})

it("does not retry an already single-document batch that cannot be deleted", async () => {
  const ref = seed()
  db.seed(ref.path, { ...db.data(ref.path), cleanupBatchSize: 1 })
  db.deleteByteLimit = 0
  const transaction = vi.spyOn(db, "runTransaction")
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    failed: 1,
    completed: 0,
  })
  expect(transaction).toHaveBeenCalledTimes(1)
  expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
  expect(db.data(ref.path)).toMatchObject({
    cleanupStatus: "pending",
    deletedCount: 0,
  })
})

it("advances past persistent failures and malformed records, then wraps", async () => {
  db.seed("participationStates/000-malformed", { cleanupStatus: "pending" })
  const refs = Array.from({ length: 9 }, (_, i) =>
    seed(`participant-${i}`, `withdrawal-${i}`),
  )
  db.failCommit = () => true
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    scanned: 8,
    failed: 8,
  })
  db.failCommit = undefined
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    scanned: 2,
    completed: 2,
  })
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    scanned: 8,
    completed: 7,
    failed: 1,
  })
  expect(
    refs.every((ref) => db.data(ref.path)?.cleanupStatus === "complete"),
  ).toBe(true)
})

it("checkpoints before starting deletion", async () => {
  const ref = seed()
  db.beforeCommit = async () => {
    expect(db.data("maintenance/withdrawalCleanup")?.cursor).toBe(ref.id)
  }
  await sweepWithdrawalCleanup()
})

it("rejects withdrawal state without its explicit history boundary", async () => {
  const ref = seed()
  const data = db.data(ref.path)
  delete data?.lastWithdrawalId
  db.seed(ref.path, data ?? {})
  expect(await sweepWithdrawalCleanup()).toMatchObject({ failed: 1 })
  db.seed(`participationEvents/withdrawal-${ref.id}`, {
    pseudonym: "participant",
    eventType: "withdrawal",
  })
  expect(await sweepWithdrawalCleanup()).toMatchObject({ failed: 1 })
  expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
})

it("shares one deadline across slow candidates and resumes fairly without losing progress", async () => {
  const start = Date.now()
  let now = start
  vi.spyOn(Date, "now").mockImplementation(() => now)
  const refs = ["slow-a", "slow-b"]
    .map((pseudonym) => {
      const ref = seed(pseudonym, `withdrawal-${pseudonym}`)
      for (let i = 0; i < 900; i++)
        db.seed(`analysisQuestionnaires/${pseudonym}-${i}`, { pseudonym })
      return ref
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  const advanceClock = async () => {
    now += 5_000
    db.beforeCommit = advanceClock
  }
  db.beforeCommit = advanceClock
  for (let index = 0; index < refs.length; index++) {
    expect(await sweepWithdrawalCleanup()).toMatchObject({
      scanned: 1,
      pending: 1,
      completed: 0,
    })
    expect(now - start).toBe((index + 1) * 40_000)
    expect(db.data(refs[index].path)).toMatchObject({
      cleanupStatus: "pending",
      deletedCount: 800,
    })
    expect(db.data("maintenance/withdrawalCleanup")?.cursor).toBe(
      refs[index].id,
    )
  }
  db.beforeCommit = undefined
  expect(await sweepWithdrawalCleanup()).toMatchObject({ completed: 2 })
  for (const ref of refs)
    expect(db.data(ref.path)).toMatchObject({
      cleanupStatus: "complete",
      deletedCount: 901,
    })
})

it("passes only the remaining sweep time after completing another participant", async () => {
  const start = Date.now()
  let now = start
  vi.spyOn(Date, "now").mockImplementation(() => now)
  const names = ["first", "second"].sort((a, b) =>
    getParticipationStateRef(a).id.localeCompare(
      getParticipationStateRef(b).id,
    ),
  )
  const refs = names.map((name) => seed(name, `withdrawal-${name}`))
  for (let i = 0; i < 900; i++)
    db.seed(`analysisQuestionnaires/large-${i}`, { pseudonym: names[1] })
  const advanceClock = async () => {
    now += 5_000
    db.beforeCommit = advanceClock
  }
  db.beforeCommit = advanceClock
  expect(await sweepWithdrawalCleanup()).toMatchObject({
    scanned: 2,
    completed: 1,
    pending: 1,
  })
  expect(now - start).toBe(40_000)
  expect(db.data(refs[0].path)?.cleanupStatus).toBe("complete")
  expect(db.data(refs[1].path)).toMatchObject({
    cleanupStatus: "pending",
    deletedCount: 400,
  })
})

it("rejects transaction retries after the deadline and resumes on the next invocation", async () => {
  let now = Date.now()
  vi.spyOn(Date, "now").mockImplementation(() => now)
  const ref = seed()
  db.beforeCommit = async () => {
    now += 40_000
    db.seed(ref.path, { ...db.data(ref.path), updatedAt: Timestamp.now() })
  }
  expect(await sweepWithdrawalCleanup()).toMatchObject({ pending: 1 })
  expect(db.retries).toBe(1)
  expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
  expect(db.data(ref.path)?.deletedCount).toBe(0)
  expect(await sweepWithdrawalCleanup()).toMatchObject({ completed: 1 })
})

it.each(["participationStates", "analysisQuestionnaires"])(
  "stops after a slow %s query consumes the budget without committing deletion",
  async (collection) => {
    let now = Date.now()
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const ref = seed()
    const query = db.query.bind(db)
    vi.spyOn(db, "query").mockImplementation((request) => {
      if (request.path === collection) now += 40_000
      return query(request)
    })
    expect(await sweepWithdrawalCleanup()).toMatchObject({
      scanned: collection === "participationStates" ? 0 : 1,
      pending: collection === "participationStates" ? 0 : 1,
      completed: 0,
    })
    expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
    expect(db.data(ref.path)?.deletedCount).toBe(0)
    expect(db.commits).toBe(0)
  },
)

it("preserves a terminal receipt that arrived before stale research deletion", async () => {
  seed()
  db.seed("analysisAttempts/participant", {
    pseudonym: "participant",
    analysisId: "participant",
    outcome: "started",
    receivedAt: Timestamp.fromMillis(1000),
    startedAtMs: 1000,
  })
  const terminal = {
    pseudonym: "participant",
    analysisId: "participant",
    outcome: "completed",
    endedAtMs: 2000,
    outcomeReceivedAt: Timestamp.fromMillis(2100),
  }
  db.seed("analysisRuns/participant", terminal)
  await deleteWithdrawnParticipantData("participant", "withdrawal-1")
  expect(db.data("analysisRuns/participant")).toMatchObject(terminal)
  expect(db.data("analysisRuns/participant")?.attemptDeletedAt).toBeInstanceOf(
    Timestamp,
  )
  expect(db.data("analysisAttempts/participant")).toBeUndefined()
})

it("rejects divergent job and state progress before deleting research", async () => {
  seed()
  db.seed("withdrawalJobs/withdrawal-1", {
    pseudonym: "participant",
    consentBoundaryId: null,
    status: "pending",
    deletedCount: 1,
  })
  await expect(
    deleteWithdrawnParticipantData("participant", "withdrawal-1"),
  ).rejects.toMatchObject({ code: "WITHDRAWAL_JOB_CONFLICT" })
  expect(db.data("analysisQuestionnaires/participant")).toBeDefined()
})
