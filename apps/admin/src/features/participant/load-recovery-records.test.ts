import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const { env, get, select, where, transaction } = vi.hoisted(() => ({
  env: { participantApiServerId: "selected" },
  get: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock("@aerpp/config/server/admin", () => ({ env }))
vi.mock("@/lib/firestore", () => ({
  firestore: {
    runTransaction: transaction,
    collection: (name: string) => ({
      doc: (id: string) => ({ name, id }),
      where: (field: string, op: string, value: string) => {
        where(name, field, op, value)
        return {
          select: (...fields: string[]) => {
            select(name, fields)
            return { name }
          },
        }
      },
    }),
  },
}))

import { loadRecoveryRecords } from "./load-recovery-records"

const doc = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => data,
})
const contact = {
  encryptedEmail: "synthetic-ciphertext",
  answers: { q1: "synthetic-free-text" },
  nonce: "synthetic-credential",
}
beforeEach(() => {
  vi.resetAllMocks()
  env.participantApiServerId = "selected"
  transaction.mockImplementation(async (callback) => callback({ get }))
  get.mockImplementation(async ({ name }) => {
    if (name === "participationStates")
      return doc("state", {
        pseudonym: "participant",
        status: "withdrawn",
        cleanupStatus: "pending",
        initialSurveyAcceptedAt: 1000,
        ...contact,
      })
    if (name === "accessEvents") return { docs: [] }
    const data =
      name === "participationEvents"
        ? { eventType: "consent", consentConfirmedAt: 1000 }
        : {
            outcome: "completed",
            questionnaireKind: "initial",
            startedAtMs: 2000,
            createdAt: 3000,
            submittedAt: 4000,
            presentationRecordedAt: 3500,
            recoverySubmission: {
              recoveryId: "grant",
              consentId: "new-consent",
            },
          }
    return {
      docs: [
        doc("original", {
          ...data,
          serverId: "selected",
          dataPurpose: "research",
          ...contact,
        }),
        doc("test", { ...data, serverId: "selected", dataPurpose: "test" }),
        doc("unclassified", { ...data, serverId: "selected" }),
        doc("other-server", { ...data, serverId: "other" }),
      ],
    }
  })
})
it("reads a consistent scoped snapshot across purposes and projects only operational metadata", async () => {
  const result = await loadRecoveryRecords("participant")
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    readOnly: true,
  })
  expect(where.mock.calls).toEqual(
    ["participationEvents", "analysisRuns", "accessEvents"].map((name) => [
      name,
      "pseudonym",
      "==",
      "participant",
    ]),
  )
  for (const rows of [result.events, result.attempts, result.questionnaires])
    expect(rows.map((row) => row.id)).toEqual([
      "original",
      "test",
      "unclassified",
    ])
  expect(result.state?.fields).toContainEqual(["撤回後の削除", "pending"])
  expect(
    result.state?.fields.find(([label]) => label === "初回回答受理日時")?.[1],
  ).toContain("日本時間")
  expect(result.questionnaires[0].fields).toContainEqual([
    "復旧回答の同意ID",
    "new-consent",
  ])
  const serialized = JSON.stringify(result)
  expect(serialized).not.toMatch(
    /synthetic-ciphertext|synthetic-free-text|synthetic-credential/,
  )
  for (const [, fields] of select.mock.calls)
    expect(fields).not.toEqual(expect.arrayContaining(["encryptedEmail"]))
})
it("supports all-server scope and shows consumed or superseded grants separately from consent", async () => {
  env.participantApiServerId = "all"
  get.mockResolvedValueOnce(
    doc("state", {
      pseudonym: "participant",
      recoveryAuthorization: {
        recoveryId: "grant",
        consumedAt: 5000,
        usedConsentId: "new-consent",
      },
    }),
  )
  get.mockResolvedValueOnce({
    docs: [
      doc("grant", {
        eventType: "recovery_authorized",
        authorizedAt: 2000,
        supersededAt: 3000,
        supersededBy: "next",
        reason: "Synthetic review",
        actorId: "actor",
      }),
    ],
  })
  const result = await loadRecoveryRecords("participant")
  expect(result.attempts).toHaveLength(4)
  expect(result.events[0].fields).toContainEqual(["差し替え先許可ID", "next"])
  expect(result.state?.fields).toContainEqual(["適用先同意ID", "new-consent"])
})
it("returns empty history for absent participants without guessing a state", async () => {
  get.mockResolvedValue({ id: "missing", data: () => undefined, docs: [] })
  expect(await loadRecoveryRecords("missing")).toMatchObject({
    state: null,
    events: [],
    attempts: [],
    questionnaires: [],
  })
})

it("does not reconstruct operational history from research records without a run", async () => {
  get.mockImplementation(async ({ name }) => {
    if (name === "analysisAttempts" || name === "analysisQuestionnaires")
      throw new Error(
        "Research records must not be queried for recovery history",
      )
    return { data: () => undefined, docs: [] }
  })
  const result = await loadRecoveryRecords("participant")
  expect(result.attempts).toEqual([])
  expect(result.questionnaires).toEqual([])
})

it("shows retained operational runs and access receipts after physical research deletion", async () => {
  get.mockImplementation(async ({ name }) => {
    if (name === "participationStates")
      return doc("state", { pseudonym: "participant", status: "withdrawn" })
    if (name === "analysisRuns")
      return {
        docs: [
          doc("run", {
            ...contact,
            serverId: "selected",
            analysisId: "run",
            outcome: "completed",
            startedAtMs: 1000,
            endedAtMs: 2000,
            receivedAt: 1100,
            outcomeReceivedAt: 2100,
            createdAt: 2200,
            submittedAt: 2300,
            attemptDeletedAt: 3000,
            questionnaireDeletedAt: 3000,
            researchWithdrawalId: "withdrawal",
            recoverySubmission: {
              recoveryId: "grant",
              consentId: "new-consent",
            },
          }),
        ],
      }
    if (name === "accessEvents")
      return {
        docs: [
          doc("receipt", {
            serverId: "selected",
            eventType: "analysis_terminal",
            recordedAt: 2100,
            outcome: "completed",
          }),
        ],
      }
    return { docs: [] }
  })
  const result = await loadRecoveryRecords("participant")
  expect(result.attempts).toHaveLength(1)
  expect(result.attempts[0].fields).toContainEqual([
    "研究データ削除の撤回ID",
    "withdrawal",
  ])
  expect(
    result.attempts[0].fields.find(([label]) => label === "終了受付日時")?.[1],
  ).toContain("日本時間")
  expect(result.questionnaires[0].fields).toContainEqual([
    "復旧回答の同意ID",
    "new-consent",
  ])
  expect(result.events[0]).toMatchObject({ id: "receipt", time: 2100 })
  expect(JSON.stringify(result)).not.toMatch(
    /synthetic-ciphertext|synthetic-free-text|synthetic-credential/,
  )
})
