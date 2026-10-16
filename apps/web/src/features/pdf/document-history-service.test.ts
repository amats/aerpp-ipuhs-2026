import { beforeEach, expect, it, vi } from "vitest"

const { session, history, generate, original, scope, render } = vi.hoisted(
  () => ({
    session: {
      stage: "withdrawn",
      consentId: "consent-1",
      pseudonym: "person-1",
    },
    history: vi.fn(),
    generate: vi.fn(),
    original: vi.fn(),
    scope: vi.fn(),
    render: vi.fn(),
  }),
)
vi.mock("@aerpp/documents/pdf", () => ({ renderDocumentPdf: render }))
vi.mock("@/features/session/session-operation", () => ({
  withSessionRead: (token: string, operation: () => unknown) => {
    scope(token)
    return operation()
  },
}))
vi.mock("@/lib/session", () => ({ getSession: async () => session }))
vi.mock("@/features/auth/email", () => ({
  readEmailFromSession: async () => "synthetic@example.invalid",
}))
vi.mock("@/features/identity/participant-identifiers", () => ({
  createPseudonym: () => "person-1",
}))
vi.mock("@/features/auth/auth-service", () => ({
  listParticipationEvents: history,
}))
vi.mock("./generate-pdf", () => ({ generateRecordedParticipantPdf: generate }))
vi.mock("./pdf-templates", () => ({
  readRecordedPdfTemplate: original,
  readPdfFont: async () => new Uint8Array([1]),
}))
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }))

import {
  listDocumentHistory,
  loadHistoricalDocument,
} from "./document-history-service"

const record = (
  id: string,
  date: string,
  eventType = "consent",
  pseudonym = "person-1",
) => ({
  id,
  consentId: id,
  pseudonym,
  eventType,
  eventAt: new Date(date),
  encryptedEmail: "private-ciphertext",
  documentSet: { version: "1.0", sha256: "a".repeat(64) },
})
beforeEach(() => {
  vi.clearAllMocks()
  session.stage = "withdrawn"
  history.mockResolvedValue([
    record("consent-1", "2026-01-01T00:00:00Z"),
    record("consent-2", "2026-01-02T00:00:00Z"),
    {
      ...record("withdrawal-1", "2026-01-03T00:00:00Z", "withdrawal"),
      consentId: "consent-1",
    },
    record("foreign", "2026-01-04T00:00:00Z", "consent", "other-person"),
  ])
  generate.mockResolvedValue({ pdfBytes: new Uint8Array([1, 2, 3]) })
  original.mockResolvedValue(new Uint8Array([4, 5, 6]))
  render.mockResolvedValue(new Uint8Array([7, 8, 9]))
})
it.each(["withdrawn", "follow_up", "authenticated"])(
  "lists own periods with an existing %s session and no contact leakage",
  async (stage) => {
    session.stage = stage
    const result = await listDocumentHistory("selected-token")
    expect(result.ok).toBe(true)
    expect(scope).toHaveBeenCalledWith("selected-token")
    expect(history).toHaveBeenCalledWith("person-1", { requireComplete: true })
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|synthetic@|foreign/)
    if (result.ok === true) {
      expect(result.history.current.consent.id).toBe("consent-1")
      expect(result.history.current.withdrawal?.id).toBe("withdrawal-1")
      expect(
        result.history.previous.map((period) => period.consent.id),
      ).toEqual(["consent-2"])
    }
  },
)
it("downloads the selected historical event, never the latest consent", async () => {
  expect(
    (await loadHistoricalDocument("consent-1", "consent", "selected-token")).ok,
  ).toBe(true)
  expect(generate.mock.calls[0][0].id).toBe("consent-1")
})
it.each(["explanation", "plan"])(
  "uses the selected event's originals for historical %s",
  async (name) => {
    const result = await loadHistoricalDocument(
      "consent-1",
      name,
      "selected-token",
    )
    expect(result.ok).toBe(true)
    expect(original).toHaveBeenCalledWith(
      name,
      expect.objectContaining({ id: "consent-1" }),
    )
    expect(render).toHaveBeenCalledWith(
      new Uint8Array([4, 5, 6]),
      new Uint8Array([1]),
      { version: "1.0", sha256: "a".repeat(64) },
    )
    expect(generate).not.toHaveBeenCalled()
  },
)
it("keeps each consent and withdrawal's own version and dates and orders other periods by their last event", async () => {
  history.mockResolvedValue([
    record("consent-1", "2026-01-01T00:00:00Z"),
    record("consent-2", "2026-01-02T00:00:00Z"),
    record("consent-3", "2026-01-03T00:00:00Z"),
    {
      ...record("withdrawal-2", "2026-01-04T00:00:00Z", "withdrawal"),
      consentId: "consent-2",
      documentSet: { version: "2.0", sha256: "b".repeat(64) },
    },
  ])
  const result = await listDocumentHistory()
  expect(result.ok).toBe(true)
  if (result.ok !== true) throw new Error("Expected history")
  expect(result.history.current.consent.id).toBe("consent-1")
  expect(result.history.previous.map((period) => period.consent.id)).toEqual([
    "consent-2",
    "consent-3",
  ])
  expect(result.history.previous[0].consent.documentSet.version).toBe("1.0")
  expect(result.history.previous[0].withdrawal?.documentSet.version).toBe("2.0")
  expect(result.history.previous[0].withdrawal?.date).toBe(
    "2026-01-04T00:00:00.000Z",
  )
})
it.each([
  "missing-current",
  "unlinked-withdrawal",
  "duplicate-consent",
  "duplicate-withdrawal",
])("does not invent or omit a history relationship: %s", async (scenario) => {
  const consent = record("consent-1", "2026-01-01T00:00:00Z")
  const withdrawal = {
    ...record("withdrawal-1", "2026-01-02T00:00:00Z", "withdrawal"),
    consentId: "consent-1",
  }
  history.mockResolvedValue(
    scenario === "missing-current"
      ? []
      : scenario === "unlinked-withdrawal"
        ? [consent, { ...withdrawal, consentId: undefined }]
        : scenario === "duplicate-consent"
          ? [consent, { ...consent, id: "duplicate" }]
          : [consent, withdrawal, { ...withdrawal, id: "duplicate" }],
  )
  expect((await listDocumentHistory()).ok).toBe(false)
})
it("fails historical PDF generation without substituting another template", async () => {
  generate.mockRejectedValueOnce(new Error("Archived document missing"))
  expect((await loadHistoricalDocument("consent-1", "consent")).ok).toBe(false)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(original).not.toHaveBeenCalled()
})
it.each([
  ["foreign", "consent"],
  ["consent-1", "withdrawal"],
  ["missing", "consent"],
])("rejects foreign or mismatched history %s/%s", async (id, name) => {
  expect((await loadHistoricalDocument(id, name)).ok).toBe(false)
  expect(generate).not.toHaveBeenCalled()
  expect(original).not.toHaveBeenCalled()
})
it.each([
  "unauthenticated",
  "confirmation_sent",
  "invalid",
  "false",
  null,
  true,
  1,
  {},
  [],
])(
  "does not grant history or download access from an unconfirmed stage: %j",
  async (stage) => {
    session.stage = stage as string
    expect((await listDocumentHistory()).ok).toBe(false)
    expect((await loadHistoricalDocument("consent-1", "consent")).ok).toBe(
      false,
    )
    expect(history).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
  },
)
