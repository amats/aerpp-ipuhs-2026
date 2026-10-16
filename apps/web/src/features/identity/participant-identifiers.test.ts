import { beforeEach, describe, expect, it, vi } from "vitest"

const sessionSaveMock = vi.fn()
const generateRandomStringMock = vi.fn()
vi.mock("@/features/identity/random-id", () => ({
  generateRandomIdSuffix: generateRandomStringMock,
}))

describe("identity ids", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionSaveMock.mockResolvedValue(true)
  })

  it("returns an existing client id from session", async () => {
    const session = {
      clientId: `aerpp:cid-${"x".repeat(32)}`,
    } as never

    const { readClientIdFromSession } = await import(
      "./participant-identifiers"
    )

    await expect(readClientIdFromSession(session)).resolves.toBe(
      `aerpp:cid-${"x".repeat(32)}`,
    )
    expect(generateRandomStringMock).not.toHaveBeenCalled()
  })

  it("returns null for an invalid client id from session", async () => {
    const session = { clientId: "invalid", save: sessionSaveMock }

    const { readClientIdFromSession } = await import(
      "./participant-identifiers"
    )

    await expect(readClientIdFromSession(session as never)).resolves.toBeNull()
    expect(session.clientId).toBe("invalid")
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("returns null when client id is absent", async () => {
    const session = { clientId: undefined, save: sessionSaveMock }

    const { readClientIdFromSession } = await import(
      "./participant-identifiers"
    )

    await expect(readClientIdFromSession(session as never)).resolves.toBeNull()
    expect(session.clientId).toBeUndefined()
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("creates a new client id", async () => {
    generateRandomStringMock.mockReturnValue("x".repeat(32))

    const { createClientId } = await import("./participant-identifiers")

    expect(createClientId()).toBe(`aerpp:cid-${"x".repeat(32)}`)
  })

  it("returns null when client id creation fails", async () => {
    generateRandomStringMock.mockReturnValue(null)

    const { createClientId } = await import("./participant-identifiers")

    expect(createClientId()).toBeNull()
  })

  it("normalizes emails when creating pseudonyms", async () => {
    const { createPseudonym } = await import("./participant-identifiers")

    const first = createPseudonym(" USER@example.com ")
    const second = createPseudonym("user@example.com")

    expect(first).toBe(second)
    expect(first).toMatch(/^aerpp:pid-[A-Za-z0-9]+$/)
  })

  it("rejects document ids without required inputs", async () => {
    const { createParticipantDocumentId } = await import(
      "./participant-identifiers"
    )

    expect(
      createParticipantDocumentId(
        "",
        "2026年3月24日",
        "consent",
        "a".repeat(64),
      ),
    ).toBeNull()
    expect(
      createParticipantDocumentId(
        "user@example.com",
        "2026年3月24日",
        "",
        "a".repeat(64),
      ),
    ).toBeNull()
  })

  it("returns null for invalid pseudonyms in session", async () => {
    const session = { pseudonym: "invalid" } as never

    const { readPseudonymFromSession } = await import(
      "./participant-identifiers"
    )

    await expect(readPseudonymFromSession(session)).resolves.toBeNull()
  })

  it("returns a valid pseudonym from session", async () => {
    const session = {
      pseudonym: `aerpp:pid-${"x".repeat(32)}`,
    } as never

    const { readPseudonymFromSession } = await import(
      "./participant-identifiers"
    )

    await expect(readPseudonymFromSession(session)).resolves.toBe(
      `aerpp:pid-${"x".repeat(32)}`,
    )
  })
})
