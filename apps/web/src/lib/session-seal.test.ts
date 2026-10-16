import { beforeEach, describe, expect, it, vi } from "vitest"

const sealDataMock = vi.fn()
const unsealDataMock = vi.fn()
const getSessionOptionsMock = vi.fn(() => ({ cookieName: "session" }))

vi.mock("iron-session", () => ({
  sealData: sealDataMock,
  unsealData: unsealDataMock,
}))

vi.mock("@/lib/session", () => ({
  getSessionOptions: getSessionOptionsMock,
}))

describe("session-seal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sealSessionData returns the sealed payload", async () => {
    sealDataMock.mockResolvedValue("sealed-value")

    const { sealSessionData } = await import("./session-seal")

    await expect(sealSessionData({ a: 1 })).resolves.toBe("sealed-value")
    expect(sealDataMock).toHaveBeenCalledWith(
      { a: 1 },
      { cookieName: "session" },
    )
  })

  it("unsealSessionData returns the unsealed payload", async () => {
    unsealDataMock.mockResolvedValue({ a: 1 })

    const { unsealSessionData } = await import("./session-seal")

    await expect(unsealSessionData<{ a: number }>("sealed")).resolves.toEqual({
      a: 1,
    })
    expect(unsealDataMock).toHaveBeenCalledWith("sealed", {
      cookieName: "session",
    })
  })

  it("returns null when encryption or decryption fails", async () => {
    sealDataMock.mockRejectedValueOnce(new Error("seal failed"))
    unsealDataMock.mockRejectedValueOnce(new Error("unseal failed"))

    const { unsealSessionData, sealSessionData } = await import(
      "./session-seal"
    )

    await expect(sealSessionData({ a: 1 })).resolves.toBeNull()
    await expect(unsealSessionData("sealed")).resolves.toBeNull()
  })
})
