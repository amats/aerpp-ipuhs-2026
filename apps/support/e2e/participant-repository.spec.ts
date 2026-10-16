import { createHash } from "node:crypto"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import { readParticipantResearchSnapshot } from "@aerpp/firestore/participant-snapshot"
import { Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"

let database: Firestore
test.beforeAll(() => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  database = new Firestore({ projectId: "demo-participant-repository" })
})
test.afterAll(async () => {
  if (database) await database.terminate()
})

test("shared queries isolate pseudonyms while research snapshots project private fields", async () => {
  const repository = createParticipantRepository(database)
  const createdAt = new Timestamp(100, 123456000)
  await database.runTransaction(async (tx) => {
    tx.create(repository.participationEvent("consent-a"), {
      pseudonym: "a",
      eventType: "consent",
      consentConfirmedAt: createdAt,
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      encryptedEmail: "private-contact",
      tokenVerifier: "private-verifier",
    })
    tx.create(repository.participationEvent("withdrawal-b"), {
      pseudonym: "b",
      eventType: "withdrawal",
      withdrawalAcceptedAt: createdAt,
    })
    tx.create(repository.participationState("a"), {
      pseudonym: "a",
      status: "active",
      consentBoundaryId: null,
      debugResetId: "private-reset",
    })
    tx.create(repository.analysisQuestionnaire("completed"), {
      pseudonym: "a",
      serverId: "server-a",
      submittedAt: createdAt,
      answer: "7",
    })
    tx.create(repository.analysisQuestionnaire("pending"), {
      pseudonym: "a",
      submittedAt: null,
    })
    tx.create(repository.analysisQuestionnaire("missing"), { pseudonym: "a" })
    tx.create(repository.analysisQuestionnaire("other"), {
      pseudonym: "b",
      submittedAt: createdAt,
    })
    tx.create(repository.analysisAttempt("started"), {
      pseudonym: "a",
      outcome: "started",
    })
  })
  expect(repository.participationState("a").id).toBe(
    createHash("sha256").update("a").digest("hex"),
  )
  expect((await repository.analysisQuestionnairesFor("a").get()).size).toBe(3)
  expect((await repository.analysisQuestionnairesFor("b").get()).size).toBe(1)
  expect(
    (await repository.analysisQuestionnairesFor("unknown").get()).empty,
  ).toBe(true)
  expect((await repository.analysisAttemptsFor("a").get()).size).toBe(1)
  expect(
    (
      await repository
        .participationEventsFor("a")
        .where("eventType", "==", "withdrawal")
        .get()
    ).empty,
  ).toBe(true)
  expect(
    (
      await repository
        .participationEventsFor("b")
        .where("eventType", "==", "withdrawal")
        .get()
    ).size,
  ).toBe(1)
  await database.runTransaction(async (tx) => {
    const records = await tx.get(repository.participationEventsFor("a"))
    expect(records.docs.map((doc) => doc.id)).toEqual(["consent-a"])
    tx.update(repository.analysisQuestionnaire("pending"), {
      submittedAt: createdAt,
    })
  })
  const source = await readParticipantResearchSnapshot(database)
  const paged = await readParticipantResearchSnapshot(database, {
    limits: { maxRecords: 100, maxBytes: 1024 * 1024, pageSize: 1 },
  })
  expect({ ...paged, snapshotAt: source.snapshotAt }).toEqual(source)
  expect(Date.parse(paged.snapshotAt)).toBeGreaterThanOrEqual(
    Date.parse(source.snapshotAt),
  )
  await expect(
    readParticipantResearchSnapshot(database, {
      limits: { maxRecords: 1, maxBytes: 1024 * 1024, pageSize: 1 },
    }),
  ).rejects.toThrow("capacity")
  expect(source.analysisQuestionnaires.map((doc) => doc.id)).toEqual([
    "completed",
    "missing",
    "other",
    "pending",
  ])
  expect(source.analysisQuestionnaires[0].data.submittedAt).toEqual({
    seconds: 100,
    nanoseconds: 123456000,
  })
  expect(source.attempts[0].data.outcome).toBe("started")
  expect(source.participationEvents[0].data).toEqual({
    pseudonym: "a",
    eventType: "consent",
    consentConfirmedAt: { seconds: 100, nanoseconds: 123456000 },
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
  })
  expect(source.participationStates[0].data).toEqual({
    pseudonym: "a",
    status: "active",
    consentBoundaryId: null,
  })
  expect(JSON.stringify(source)).not.toContain("private-")
  expect(Number.isFinite(Date.parse(source.snapshotAt))).toBe(true)
})
