import { beforeEach, describe, expect, it, vi } from "vitest"

const createPseudonymMock = vi.fn()
const sealSessionDataMock = vi.fn()
const unsealSessionDataMock = vi.fn()

vi.mock("@/features/identity/participant-identifiers", () => ({
  createPseudonym: createPseudonymMock,
}))

vi.mock("@/lib/session-seal", () => ({
  sealSessionData: sealSessionDataMock,
  unsealSessionData: unsealSessionDataMock,
}))

describe("auth email helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads the email stored in session", async () => {
    const session = { email: "user@example.com" } as never

    const { readEmailFromSession } = await import("./email")

    await expect(readEmailFromSession(session)).resolves.toBe(
      "user@example.com",
    )
  })

  it("returns null for invalid session email values", async () => {
    const session = { email: "not-an-email" } as never

    const { readEmailFromSession } = await import("./email")

    await expect(readEmailFromSession(session)).resolves.toBeNull()
  })

  it("stores normalized email and pseudonym in session", async () => {
    const session = { email: "", pseudonym: "", save: vi.fn() }
    createPseudonymMock.mockReturnValue("aerpp:pid-123")

    const { writeEmailToSession } = await import("./email")

    await expect(
      writeEmailToSession(session as never, " USER@example.com "),
    ).resolves.toBe("aerpp:pid-123")
    expect(session.email).toBe("user@example.com")
    expect(session.pseudonym).toBe("aerpp:pid-123")
    expect(session.save).not.toHaveBeenCalled()
  })

  it("returns null when pseudonym generation fails", async () => {
    createPseudonymMock.mockReturnValue(null)

    const { writeEmailToSession } = await import("./email")

    await expect(
      writeEmailToSession({} as never, "user@example.com"),
    ).resolves.toBeNull()
  })

  it("returns null when storing an invalid email", async () => {
    const { writeEmailToSession } = await import("./email")

    await expect(
      writeEmailToSession({} as never, "not-an-email"),
    ).resolves.toBeNull()
    expect(createPseudonymMock).not.toHaveBeenCalled()
  })

  it("wraps encryption and decryption helpers", async () => {
    sealSessionDataMock.mockResolvedValue("sealed")
    unsealSessionDataMock.mockResolvedValue("user@example.com")

    const { decryptEmail, encryptEmail } = await import("./email")

    await expect(encryptEmail("user@example.com")).resolves.toBe("sealed")
    await expect(decryptEmail("sealed")).resolves.toBe("user@example.com")
  })

  it("returns null when decrypted email content is invalid", async () => {
    unsealSessionDataMock.mockResolvedValue("not-an-email")

    const { decryptEmail } = await import("./email")

    await expect(decryptEmail("sealed")).resolves.toBeNull()
  })

  it("returns null when encryption helpers fail", async () => {
    sealSessionDataMock.mockRejectedValue(new Error("seal failed"))
    unsealSessionDataMock.mockRejectedValue(new Error("unseal failed"))

    const { decryptEmail, encryptEmail } = await import("./email")

    await expect(encryptEmail("user@example.com")).resolves.toBeNull()
    await expect(decryptEmail("sealed")).resolves.toBeNull()
  })
})
