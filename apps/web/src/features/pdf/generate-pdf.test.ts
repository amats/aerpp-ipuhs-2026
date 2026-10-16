import { beforeEach, describe, expect, it, vi } from "vitest"

const readFileMock = vi.fn()
const listParticipationEventsMock = vi.fn()
const createPseudonymMock = vi.fn()
const generateDocumentIdMock = vi.fn()

const emailField = { setValue: vi.fn(), setFont: vi.fn() }
const dateField = { setValue: vi.fn(), setFont: vi.fn() }
const form = {
  getTextField: vi.fn((name: string) => {
    if (name === "email") return emailField
    if (name === "date") return dateField
    return undefined
  }),
  removeField: vi.fn(),
  getFields: vi.fn(() => []),
  flatten: vi.fn(),
}
const pdfPage = { drawLine: vi.fn(), drawText: vi.fn() }
const pdfDoc = {
  getForm: vi.fn(() => form),
  embedFont: vi.fn(() => "font"),
  getPages: vi.fn(() => [pdfPage]),
  save: vi.fn(async () => new Uint8Array([9, 9, 9])),
}
const pdfLoadMock = vi.fn(async () => pdfDoc)

vi.mock("@/features/auth/email", () => ({
  decryptEmail: vi.fn(async () => "user@example.com"),
}))
vi.mock("./pdf-templates", () => ({
  readPdfFont: readFileMock,
  readRecordedPdfTemplate: readFileMock,
}))

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}))

vi.mock("@libpdf/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@libpdf/core")>()),
  PDF: {
    load: pdfLoadMock,
  },
}))

vi.mock("@/features/auth/auth-service", () => ({
  listParticipationEvents: listParticipationEventsMock,
}))

vi.mock("@/features/identity/participant-identifiers", () => ({
  createPseudonym: createPseudonymMock,
  createParticipantDocumentId: generateDocumentIdMock,
}))

describe("pdf generation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    form.getTextField.mockImplementation((name: string) => {
      if (name === "email") return emailField
      if (name === "date") return dateField
      return undefined
    })
    readFileMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    createPseudonymMock.mockReturnValue("psn_123")
    generateDocumentIdMock.mockReturnValue("aerpp:did-123")
  })

  const consent = (
    id: string,
    date: string,
    precedingWithdrawalId: string | null = null,
  ) => ({
    id,
    consentId: id,
    pseudonym: "psn_123",
    encryptedEmail: "ciphertext",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    eventType: "consent",
    precedingWithdrawalId,
    consentRequestedAt: new Date(new Date(date).getTime() - 86_400_000),
    eventAt: new Date(date),
  })
  const withdrawal = (id: string, consentId: string, date: string) => ({
    id,
    consentId,
    pseudonym: "psn_123",
    encryptedEmail: "ciphertext",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    eventType: "withdrawal",
    eventAt: new Date(date),
  })
  const history = [
    consent("first", "2026-03-20T15:00:00.000Z"),
    consent("other-device", "2026-03-22T00:00:00.000Z"),
    withdrawal("withdrawal-1", "other-device", "2026-03-23T00:00:00.000Z"),
    consent("renewed", "2026-03-24T00:00:00.000Z", "withdrawal-1"),
    consent("renewed-device", "2026-03-25T00:00:00.000Z", "withdrawal-1"),
    withdrawal("withdrawal-2", "renewed", "2026-03-26T00:00:00.000Z"),
  ]

  it.each([
    ["first", "2026年3月21日"],
    ["other-device", "2026年3月22日"],
    ["renewed", "2026年3月24日"],
    ["renewed-device", "2026年3月25日"],
  ])(
    "uses the original confirmation date of this consent (%s)",
    async (consentId, date) => {
      listParticipationEventsMock.mockResolvedValue([...history].reverse())
      const { generateConsentPdf } = await import("./generate-pdf")
      const result = await generateConsentPdf("user@example.com", consentId)
      expect(result).toEqual({
        documentId: "aerpp:did-123",
        pdfBytes: new Uint8Array([9, 9, 9]),
      })
      expect(emailField.setValue).toHaveBeenCalledWith("user@example.com")
      expect(dateField.setValue).toHaveBeenCalledWith(date)
      expect(generateDocumentIdMock).toHaveBeenCalledWith(
        "user@example.com",
        date,
        "consent",
        "a".repeat(64),
      )
      expect(pdfPage.drawText).toHaveBeenCalledWith(
        "DID  aerpp:did-123",
        expect.objectContaining({ font: "Courier", size: 9 }),
      )
      expect(form.flatten).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ["first", "2026年3月23日"],
    ["other-device", "2026年3月23日"],
    ["renewed-device", "2026年3月26日"],
  ])(
    "uses the accepted withdrawal from the session's period (%s)",
    async (consentId, date) => {
      listParticipationEventsMock.mockResolvedValue([...history].reverse())
      const { generateWithdrawalPdf } = await import("./generate-pdf")
      await generateWithdrawalPdf("user@example.com", consentId)
      expect(dateField.setValue).toHaveBeenCalledWith(date)
      expect(generateDocumentIdMock).toHaveBeenCalledWith(
        "user@example.com",
        date,
        "withdrawal",
        "a".repeat(64),
      )
    },
  )

  it("uses the withdrawal boundary even when confirmation timestamps are equal", async () => {
    listParticipationEventsMock.mockResolvedValue([
      consent("first", "2026-03-20T00:00:00.000Z"),
      withdrawal("withdrawal-1", "first", "2026-03-21T00:00:00.000Z"),
      consent("renewed", "2026-03-21T00:00:00.000Z", "withdrawal-1"),
    ])
    const { generateConsentPdf, generateWithdrawalPdf } = await import(
      "./generate-pdf"
    )
    await generateConsentPdf("user@example.com", "renewed")
    expect(dateField.setValue).toHaveBeenCalledWith("2026年3月21日")
    await expect(
      generateWithdrawalPdf("user@example.com", "renewed"),
    ).rejects.toThrow("no withdrawal record found")
  })

  it.each(["generateConsentPdf", "generateWithdrawalPdf"] as const)(
    "rejects %s without the session consent",
    async (name) => {
      listParticipationEventsMock.mockResolvedValue(history)
      const actions = await import("./generate-pdf")
      await expect(
        actions[name]("user@example.com", "missing"),
      ).rejects.toThrow("no session consent record found")
      expect(readFileMock).not.toHaveBeenCalled()
    },
  )

  it("does not issue a receipt for a new period before withdrawal is accepted", async () => {
    listParticipationEventsMock.mockResolvedValue(history.slice(0, -1))
    const { generateWithdrawalPdf } = await import("./generate-pdf")
    await expect(
      generateWithdrawalPdf("user@example.com", "renewed"),
    ).rejects.toThrow("no withdrawal record found")
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it("throws when consent document id generation fails", async () => {
    listParticipationEventsMock.mockResolvedValue(history)
    generateDocumentIdMock.mockReturnValue(null)
    const { generateConsentPdf } = await import("./generate-pdf")
    await expect(
      generateConsentPdf("user@example.com", "first"),
    ).rejects.toThrow("failed to generate document ID")
  })
})
