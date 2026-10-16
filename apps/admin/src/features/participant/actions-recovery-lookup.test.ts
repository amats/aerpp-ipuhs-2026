import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: { identifierHashSecret: "synthetic-identifier-secret" },
}))
const { auth, load, log } = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  log: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: auth }))
vi.mock("@/lib/logger", () => ({ logRecoveryLookupFailure: log }))
vi.mock("./load-recovery-records", () => ({ loadRecoveryRecords: load }))

import { lookupParticipationRecoveryAction } from "./actions-recovery-lookup"

function input(mode: string, value: string) {
  const data = new FormData()
  data.set("mode", mode)
  data.set("value", value)
  data.set("requestId", "3")
  return data
}
beforeEach(() => {
  vi.resetAllMocks()
  load.mockImplementation(async (pseudonym) => ({ pseudonym }))
})

it("authenticates before reading and returns PID without echoing contact input", async () => {
  const result = await lookupParticipationRecoveryAction(
    { message: "" },
    input("email", " PERSON@EXAMPLE.INVALID "),
  )
  expect(auth).toHaveBeenCalledWith("/participant")
  expect(load).toHaveBeenCalledWith(
    "aerpp:pid-adc0246ab71baf83eed95b5d77a4e689",
  )
  expect(result.requestId).toBe("3")
  expect(JSON.stringify(result)).not.toMatch(/@|identifier-secret/)
  expect(log).not.toHaveBeenCalled()
})
it("preserves authentication redirect control flow and never reads without it", async () => {
  auth.mockRejectedValue(new Error("synthetic-auth-redirect"))
  await expect(
    lookupParticipationRecoveryAction(
      { message: "" },
      input("pid", "synthetic-person"),
    ),
  ).rejects.toThrow("synthetic-auth-redirect")
  expect(load).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
})
it.each([
  ["email", "invalid"],
  ["pid", ""],
  ["pid", "x".repeat(257)],
  ["unknown", "person@example.invalid"],
])("rejects invalid lookup %s", async (mode, value) => {
  const result = await lookupParticipationRecoveryAction(
    { message: "" },
    input(mode, value),
  )
  expect(result.lookup).toBeUndefined()
  expect(load).not.toHaveBeenCalled()
})
it("looks up PID directly and discards old results on read failure", async () => {
  const result = await lookupParticipationRecoveryAction(
    { message: "" },
    input("pid", "synthetic-person"),
  )
  expect(result.lookup?.pseudonym).toBe("synthetic-person")
  load.mockRejectedValue(new Error("sensitive person@example.invalid"))
  const failed = await lookupParticipationRecoveryAction(
    result,
    input("pid", "synthetic-person"),
  )
  expect(failed.lookup).toBeUndefined()
  expect(failed.message).toContain("再度照会")
  expect(JSON.stringify(failed)).not.toContain("@")
  expect(log).toHaveBeenCalledOnce()
})
