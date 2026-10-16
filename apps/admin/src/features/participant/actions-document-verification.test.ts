vi.mock("server-only", () => ({}))
vi.mock("./document-archive", () => ({
  verifyDocumentArchive: archive,
}))
vi.mock("@/lib/firestore", () => ({
  firestore: {
    collection: () => ({ where: () => ({ get: records }) }),
  },
}))

import { beforeEach, expect, it, vi } from "vitest"

const { auth, archive, records } = vi.hoisted(() => ({
  auth: vi.fn(),
  archive: vi.fn(),
  records: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: auth }))
vi.mock("@aerpp/config/server/admin", () => ({
  env: {
    identifierHashSecret: "synthetic-identifier-secret",
    participantApiServerId: "all",
  },
}))

import { verifyParticipantDocumentAction } from "./actions-document-verification"

function input(overrides: Record<string, string | undefined> = {}) {
  const form = new FormData()
  for (const [key, value] of Object.entries({
    email: " PERSON@EXAMPLE.INVALID ",
    date: "2026-03-20",
    purpose: "consent",
    did: "aerpp:did-b2452bd0cf7b9ae1fcb4bba54647bf1a",
    version: "1.0",
    sha256: "a".repeat(64),
    requestId: "1",
    ...overrides,
  }))
    if (value !== undefined) form.set(key, value)
  return form
}
beforeEach(() => {
  vi.resetAllMocks()
  records.mockResolvedValue({ docs: [] })
})
it("authenticates and matches a pinned Web-compatible HMAC without echoing email or key", async () => {
  const result = await verifyParticipantDocumentAction({ message: "" }, input())
  expect(auth).toHaveBeenCalledWith("/participant")
  expect(result).toMatchObject({
    matched: true,
    requestId: "1",
    pseudonym: "aerpp:pid-adc0246ab71baf83eed95b5d77a4e689",
  })
  expect(JSON.stringify(result)).not.toMatch(/@|identifier-secret/)
})
it.each([
  { date: "2026-03-21" },
  { purpose: "withdrawal" },
  { email: "other@example.invalid" },
  { did: `aerpp:did-${"0".repeat(32)}` },
])("rejects a changed binding %j", async (fields) => {
  expect(
    (await verifyParticipantDocumentAction({ message: "" }, input(fields)))
      .matched,
  ).toBe(false)
})
it.each([
  { date: "2026-02-30" },
  { purpose: "other" },
  { email: "invalid" },
  { did: "aerpp:did-short" },
])(
  "rejects malformed input without keeping a previous match %j",
  async (fields) => {
    const result = await verifyParticipantDocumentAction(
      { message: "old", matched: true },
      input(fields),
    )
    expect(result.matched).toBeUndefined()
    expect(result.pseudonym).toBeUndefined()
  },
)
it("preserves the authentication redirect", async () => {
  auth.mockRejectedValue(new Error("auth-redirect"))
  await expect(
    verifyParticipantDocumentAction({ message: "" }, input()),
  ).rejects.toThrow("auth-redirect")
})

it("reports mathematical match separately from missing originals and an actual accepted receipt", async () => {
  archive.mockRejectedValue(new Error("missing original"))
  records.mockResolvedValue({
    docs: [
      {
        data: () => ({
          eventType: "consent",
          consentConfirmedAt: "2026-03-20T00:00:00Z",
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
        }),
      },
    ],
  })
  expect(
    await verifyParticipantDocumentAction({ message: "" }, input()),
  ).toMatchObject({
    matched: true,
    archiveVerified: false,
    receiptMatched: true,
  })
})
it("does not interpret a failed receipt query as an absent or accepted record", async () => {
  records.mockRejectedValue(new Error("synthetic query failure"))
  const result = await verifyParticipantDocumentAction({ message: "" }, input())
  expect(result).toMatchObject({ matched: true, archiveVerified: true })
  expect(result.receiptMatched).toBeUndefined()
})
