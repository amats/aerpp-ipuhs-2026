import { createHash } from "node:crypto"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  review: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  logAccepted: vi.fn(),
  logFailure: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: { participantApiServerId: "synthetic-server" },
}))
vi.mock("@aerpp/firestore/participant-repository", () => ({
  createParticipantRepository: () => ({
    participationEvent: (id: string) => ({ id }),
  }),
}))
vi.mock("@/lib/firestore", () => ({
  firestore: { runTransaction: mocks.transaction },
}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/lib/logger", () => ({
  logParticipationRecoveryAccepted: mocks.logAccepted,
  logParticipationRecoveryFailure: mocks.logFailure,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("./participation-recovery-service", () => ({
  reviewRecovery: mocks.review,
}))

import { authorizeParticipationRecoveryAction } from "./actions-participation-recovery"

const recoveryId = "11111111-1111-4111-8111-111111111111"
const receipt = {
  actorId: createHash("sha256").update("admin@example.invalid").digest("hex"),
  pseudonym: "synthetic-person",
  destination: "follow-up-document",
  reason: "synthetic reason",
}
function input() {
  const data = new FormData()
  for (const [key, value] of Object.entries(receipt)) data.set(key, value)
  data.set("recoveryId", recoveryId)
  data.set("confirm", "yes")
  data.set("fingerprint", "synthetic-fingerprint")
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { email: "admin@example.invalid" } })
  mocks.get.mockResolvedValue({ exists: false })
  mocks.review.mockResolvedValue({
    fingerprint: "synthetic-fingerprint",
    state: { status: "active" },
    stateRef: {},
    analysisId: undefined,
  })
  mocks.transaction.mockImplementation(async (callback) => {
    const result = await callback({
      get: mocks.get,
      create: mocks.create,
      update: mocks.update,
    })
    // Successful logs belong after the transaction settles.
    expect(mocks.logAccepted).not.toHaveBeenCalled()
    return result
  })
})

it("retains a new recovery authorization without duplicate success logging or internal flags", async () => {
  const result = await authorizeParticipationRecoveryAction(
    { message: "" },
    input(),
  )
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.logAccepted).not.toHaveBeenCalled()
  expect(mocks.revalidate).toHaveBeenCalledWith("/participant")
  expect(result).not.toHaveProperty("newlyAuthorized")
})

it("does not log a duplicate accepted event for an exact recovery retry", async () => {
  mocks.get.mockResolvedValue({ exists: true, data: () => receipt })
  const result = await authorizeParticipationRecoveryAction(
    { message: "" },
    input(),
  )
  expect(result.message).toContain("既に記録")
  expect(mocks.revalidate).toHaveBeenCalledWith("/participant")
  expect(mocks.review).not.toHaveBeenCalled()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.logAccepted).not.toHaveBeenCalled()
})

it("does not log acceptance after a failed commit", async () => {
  mocks.transaction.mockRejectedValue(new Error("synthetic commit failure"))
  await authorizeParticipationRecoveryAction({ message: "" }, input())
  expect(mocks.logAccepted).not.toHaveBeenCalled()
  expect(mocks.logFailure).toHaveBeenCalledOnce()
})

it("retains the same authorization identity after commit acknowledgement loss", async () => {
  const review = {
    ...receipt,
    destination: "follow-up-document" as const,
    recoveryId,
    fingerprint: "synthetic-fingerprint",
    status: "active",
    questionnaireKind: "initial" as const,
    completedAt: null,
    presentedAt: null,
  }
  mocks.transaction.mockImplementationOnce(async (callback) => {
    await callback({
      get: mocks.get,
      create: mocks.create,
      update: mocks.update,
    })
    mocks.get.mockResolvedValue({ exists: true, data: () => receipt })
    throw new Error("commit response lost")
  })
  const pending = await authorizeParticipationRecoveryAction(
    { message: "", review },
    input(),
  )
  const { actorId: _actorId, ...expectedReview } = review
  expect(pending.review).toEqual(expectedReview)
  expect(mocks.create).toHaveBeenCalledOnce()
  const retried = await authorizeParticipationRecoveryAction(pending, input())
  expect(retried.message).toContain("既に記録")
  expect(retried.review).toBeUndefined()
  expect(mocks.create).toHaveBeenCalledOnce()
})
it("does not report a committed authorization as failed when page refresh fails", async () => {
  mocks.revalidate.mockImplementation(() => {
    throw new Error("refresh failed")
  })
  const result = await authorizeParticipationRecoveryAction(
    { message: "" },
    input(),
  )
  expect(result.message).toContain("復旧を許可しました")
  expect(mocks.create).toHaveBeenCalledOnce()
})
it("requires another review for a stale target instead of reusing confirmation", async () => {
  mocks.review.mockRejectedValue(new Error("RECOVERY_STALE"))
  const result = await authorizeParticipationRecoveryAction(
    {
      message: "",
      review: {
        ...receipt,
        destination: "follow-up-document",
        recoveryId,
        fingerprint: "synthetic-fingerprint",
        status: "active",
        questionnaireKind: "initial",
        completedAt: null,
        presentedAt: null,
      },
    },
    input(),
  )
  expect(result.review).toBeUndefined()
  expect(mocks.create).not.toHaveBeenCalled()
})
