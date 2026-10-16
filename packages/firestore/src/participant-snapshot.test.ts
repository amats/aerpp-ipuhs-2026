import { type Firestore, Timestamp } from "@google-cloud/firestore"
import { expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  run: vi.fn(),
  select: vi.fn(),
}))
const database = {
  collection: (name: string) => ({
    name,
    select: (...fields: string[]) => {
      mocks.select(name, fields)
      return { name, fields }
    },
  }),
  runTransaction: (
    callback: (transaction: { get: typeof mocks.get }) => unknown,
    options: unknown,
  ) => {
    mocks.run(options)
    return callback({ get: mocks.get })
  },
} as unknown as Firestore

import { readParticipantResearchSnapshot } from "@aerpp/firestore/participant-snapshot"

it("uses a read-only consistent transaction and excludes contact/credential fields from consent history", async () => {
  mocks.get.mockImplementation(async ({ name }: { name: string }) => ({
    docs:
      name === "analysisQuestionnaires"
        ? [
            {
              id: "a",
              data: () => ({
                submittedAt: new Timestamp(1, 123456789),
                PE1: null,
              }),
            },
          ]
        : [],
    readTime: Timestamp.fromMillis(2000),
  }))
  const data = await readParticipantResearchSnapshot(database)
  expect(mocks.run).toHaveBeenCalledWith({ readOnly: true })
  expect(data.analysisQuestionnaires[0].data).toEqual({
    submittedAt: { seconds: 1, nanoseconds: 123456789 },
    PE1: null,
  })
  expect(data.snapshotAt).toBe("1970-01-01T00:00:02.000Z")
  const fields = mocks.select.mock.calls.flatMap((call) => call[1])
  expect(fields.filter((field) => field === "dataPurpose")).toHaveLength(2)
  expect(fields).toContain("consentRequestedAt")
  expect(fields).toContain("consentConfirmedAt")
  expect(fields).toContain("withdrawalAcceptedAt")
  expect(fields).not.toContain("presentationRecordedAt")
  expect(fields).not.toContain("submittedAt")
  expect(fields).toContain("createdAt")
  expect(
    fields.filter((field) => field === "hasCompletedAnalysis"),
  ).toHaveLength(2)
  expect(fields).not.toContain("encryptedEmail")
  expect(fields).not.toContain("email")
  expect(fields).not.toContain("ipAddress")
})

it("rejects failed reads instead of returning an empty dataset", async () => {
  mocks.get.mockRejectedValue(new Error("unavailable"))
  await expect(readParticipantResearchSnapshot(database)).rejects.toThrow(
    "unavailable",
  )
})

it("includes every access row with contact projection only when explicitly requested", async () => {
  mocks.select.mockClear()
  mocks.get.mockImplementation(
    async ({ name, fields }: { name: string; fields?: string[] }) => {
      const data: Record<string, unknown> = {
        encryptedEmail: "synthetic-ciphertext",
        tokenHash: "secret",
        tokenNonce: "secret",
        credentialId: "secret",
        pseudonym: "withdrawn-person",
        dataPurpose: "test",
        status: "withdrawn",
        createdAt: new Timestamp(1, 123),
        consentRequestedAt: new Timestamp(0, 987654321),
        consentConfirmedAt: new Timestamp(1, 123456789),
        withdrawalAcceptedAt: new Timestamp(2, 987654321),
        presentationRecordedAt: new Timestamp(3, 123456789),
        submittedAt: new Timestamp(4, 987654321),
      }
      return {
        docs: [
          {
            id: `${name}-id`,
            data: () =>
              fields
                ? Object.fromEntries(
                    fields
                      .filter((key) => key in data)
                      .map((key) => [key, data[key]]),
                  )
                : { analysisId: "a", processingDurationSeconds: 3 },
          },
        ],
        readTime: Timestamp.fromMillis(2000),
      }
    },
  )
  const source = await readParticipantResearchSnapshot(database, {
    includeAccess: true,
  })
  expect(source.participationEvents[0].data.encryptedEmail).toBe(
    "synthetic-ciphertext",
  )
  expect(source.participationEvents[0].data.consentRequestedAt).toEqual({
    seconds: 0,
    nanoseconds: 987654321,
  })
  expect(source.participationEvents[0].data).toMatchObject({
    consentConfirmedAt: { seconds: 1, nanoseconds: 123456789 },
    withdrawalAcceptedAt: { seconds: 2, nanoseconds: 987654321 },
  })
  expect(source.participationEvents[0].data).not.toHaveProperty(
    "presentationRecordedAt",
  )
  expect(source.participationEvents[0].data).not.toHaveProperty("submittedAt")
  expect(source.analysisRuns?.[0].data).toMatchObject({
    presentationRecordedAt: { seconds: 3, nanoseconds: 123456789 },
    submittedAt: { seconds: 4, nanoseconds: 987654321 },
  })
  expect(source.participationEvents[0].data.createdAt).toEqual({
    seconds: 1,
    nanoseconds: 123,
  })
  expect(source.emailConfirmations).toHaveLength(1)
  expect(source.emailConfirmations?.[0].data.createdAt).toEqual({
    seconds: 1,
    nanoseconds: 123,
  })
  expect(source.participationStates[0].data.status).toBe("withdrawn")
  expect(JSON.stringify(source)).not.toContain("secret")
  const research = await readParticipantResearchSnapshot(database)
  expect(research.emailConfirmations).toBeUndefined()
  expect(research.participationEvents[0].data).not.toHaveProperty(
    "encryptedEmail",
  )
})

it("pages every collection in one consistent transaction and rejects capacity or cancellation without partial output", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    id: `row-${index}`,
    data: () => ({ answer: `value-${index}` }),
  }))
  const calls: string[] = []
  const run = vi.fn()
  function query(name: string, offset = 0, size = 2): unknown {
    return {
      name,
      offset,
      size,
      select: () => query(name, offset, size),
      orderBy: () => query(name, offset, size),
      limit: (value: number) => query(name, offset, value),
      startAfter: (doc: { id: string }) =>
        query(name, rows.findIndex((row) => row.id === doc.id) + 1, size),
    }
  }
  const controller = new AbortController()
  const database = {
    collection: (name: string) => query(name),
    runTransaction: async (
      callback: (tx: unknown) => unknown,
      options: unknown,
    ) => {
      run(options)
      return callback({
        get: async ({
          name,
          offset,
          size,
        }: {
          name: string
          offset: number
          size: number
        }) => {
          calls.push(`${name}:${offset}`)
          return {
            docs:
              name === "analysisQuestionnaires"
                ? rows.slice(offset, offset + size)
                : [],
            readTime: Timestamp.fromMillis(2000),
          }
        },
      })
    },
  } as unknown as Firestore
  const limits = { maxRecords: 5, maxBytes: 1000, pageSize: 2 }
  const source = await readParticipantResearchSnapshot(database, {
    limits,
    signal: controller.signal,
  })
  expect(source.analysisQuestionnaires.map(({ id }) => id)).toEqual(
    rows.map(({ id }) => id),
  )
  expect(run).toHaveBeenCalledExactlyOnceWith({ readOnly: true })
  expect(calls.slice(0, 3)).toEqual([
    "analysisQuestionnaires:0",
    "analysisQuestionnaires:2",
    "analysisQuestionnaires:4",
  ])
  expect(source.snapshotAt).toBe("1970-01-01T00:00:02.000Z")
  for (const bounded of [
    { ...limits, maxRecords: 4 },
    { ...limits, maxBytes: 1 },
  ])
    await expect(
      readParticipantResearchSnapshot(database, { limits: bounded }),
    ).rejects.toThrow("capacity")
  controller.abort()
  calls.length = 0
  await expect(
    readParticipantResearchSnapshot(database, {
      limits,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" })
  expect(calls).toEqual([])
})
