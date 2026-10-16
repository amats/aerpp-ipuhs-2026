import { beforeEach, describe, expect, it, vi } from "vitest"

const { runtime } = vi.hoisted(() => ({ runtime: { debugPagesEnabled: true } }))
const cookiesMock = vi.fn()
const loggerMock = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}
const createLoggerMock = vi.fn(() => loggerMock)

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: createLoggerMock,
}))

vi.mock("@aerpp/config/server/web", () => ({
  env: runtime,
}))

const scope = "11111111-1111-1111-1111-111111111111"
const name = `aerpp-session-${scope}`
describe("reset actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.debugPagesEnabled = true
  })

  it("resetSessionAction revokes sessions and deletes every accessible origin cookie", async () => {
    const deleteMock = vi.fn()
    cookiesMock.mockResolvedValue({
      getAll: () => [
        { name },
        { name: `${name}.0` },
        { name: "aerpp-session-22222222-2222-2222-2222-222222222222" },
        { name: "preference" },
      ],
      delete: deleteMock,
    })

    const { resetSessionAction } = await import("./actions-reset")

    await expect(resetSessionAction(scope)).resolves.toEqual({ ok: true })

    expect(deleteMock).toHaveBeenNthCalledWith(1, name)
    expect(deleteMock).toHaveBeenNthCalledWith(2, `${name}.0`)
    expect(deleteMock).toHaveBeenCalledTimes(4)
  })

  it("rejects participant reset when debug pages are disabled", async () => {
    runtime.debugPagesEnabled = false
    const { resetSessionAction } = await import("./actions-reset")
    await expect(resetSessionAction(scope)).resolves.toEqual({
      ok: false,
      reason: "cookie_clear_failed",
    })
    expect(cookiesMock).not.toHaveBeenCalled()
  })

  it("resetSessionAction returns a failure result for cookie store errors", async () => {
    cookiesMock.mockRejectedValue(new Error("cookie failure"))

    const { resetSessionAction } = await import("./actions-reset")

    await expect(resetSessionAction(scope)).resolves.toEqual({
      ok: false,
      reason: "cookie_clear_failed",
    })
  })
})

vi.mock("@/lib/session", () => ({
  revokeSession: vi.fn(async () => {}),
}))
