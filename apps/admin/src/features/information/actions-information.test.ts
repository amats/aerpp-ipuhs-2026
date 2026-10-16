import { beforeEach, expect, it, vi } from "vitest"
import {
  deleteInformationAction,
  saveInformationAction,
} from "./actions-information"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  log: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/lib/logger", () => ({ logInformationFailure: mocks.log }))
vi.mock("./information-service", () => ({ informationRepository: () => mocks }))
const input = {
  content: "通知",
  tone: "info",
  expireAt: "2030-01-01T00:00:00.000Z",
}
const target = {
  id: "notice",
  version: { seconds: 123456789, nanoseconds: 123456789 },
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.update.mockResolvedValue({ ok: true })
  mocks.remove.mockResolvedValue({ ok: true })
})
it("authenticates both write entrypoints before touching Firestore", async () => {
  mocks.auth.mockRejectedValue(new Error("redirect"))
  await expect(saveInformationAction(null, input)).rejects.toThrow("redirect")
  await expect(saveInformationAction(target, input)).rejects.toThrow("redirect")
  await expect(deleteInformationAction(target)).rejects.toThrow("redirect")
  expect(mocks.add).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
})
it("validates input and rejects invalid targets rather than creating", async () => {
  expect(
    (await saveInformationAction(null, { ...input, tone: "bad" })).ok,
  ).toBe(false)
  expect((await saveInformationAction(undefined, input)).ok).toBe(false)
  expect((await deleteInformationAction({ ...target, id: "a/b" })).ok).toBe(
    false,
  )
  expect(mocks.add).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
})
it("dispatches valid creates, updates and deletes with the precise version", async () => {
  expect(await saveInformationAction(null, input)).toEqual({ ok: true })
  expect(mocks.add).toHaveBeenCalledWith(input)
  expect(await saveInformationAction(target, input)).toEqual({ ok: true })
  expect(mocks.update).toHaveBeenCalledWith(target, input)
  expect(await deleteInformationAction(target)).toEqual({ ok: true })
  expect(mocks.remove).toHaveBeenCalledWith(target)
  expect(mocks.auth).toHaveBeenCalledWith("/information")
})
it.each(["conflict", "not_found"])(
  "reports %s without claiming success",
  async (code) => {
    mocks.update.mockResolvedValue({ ok: false, code })
    mocks.remove.mockResolvedValue({ ok: false, code })
    expect(await saveInformationAction(target, input)).toMatchObject({
      ok: false,
      reason: "conflict",
    })
    expect(await deleteInformationAction(target)).toMatchObject({
      ok: false,
      reason: "conflict",
    })
  },
)
it("does not expose provider errors or automatically retry ambiguous creation", async () => {
  mocks.add.mockRejectedValue(new Error("sensitive-provider-details"))
  const result = await saveInformationAction(null, input)
  expect(result.ok).toBe(false)
  expect(JSON.stringify(result)).not.toContain("sensitive-provider-details")
  expect(mocks.add).toHaveBeenCalledTimes(1)
  expect(mocks.log).toHaveBeenCalledWith("addInformation", expect.any(Error))
})
