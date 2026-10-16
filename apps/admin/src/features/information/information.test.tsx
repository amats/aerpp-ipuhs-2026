import { beforeEach, expect, it, vi } from "vitest"
import Information from "./information"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), log: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/lib/logger", () => ({ logInformationFailure: mocks.log }))
vi.mock("./information-service", () => ({ informationRepository: () => mocks }))
vi.mock("./information-manager", () => ({
  default: () => <p>Information list</p>,
}))
beforeEach(() => vi.resetAllMocks())
it("authenticates before reading notices", async () => {
  mocks.auth.mockRejectedValue(new Error("redirect"))
  await expect(Information()).rejects.toThrow("redirect")
  expect(mocks.list).not.toHaveBeenCalled()
})
it("keeps the same manager on refresh failure so its client draft survives", async () => {
  mocks.list.mockResolvedValue([])
  const loaded = await Information()
  mocks.list.mockRejectedValue(new Error("sensitive-provider-data"))
  const failed = await Information()
  expect(failed.type).toBe(loaded.type)
  expect(failed.props.records).toBeNull()
  expect(JSON.stringify(failed.props)).not.toContain("sensitive-provider-data")
  expect(mocks.log).toHaveBeenCalledWith("listInformation", expect.any(Error))
})
