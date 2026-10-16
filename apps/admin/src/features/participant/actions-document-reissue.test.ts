import { deriveParticipantPseudonym } from "@aerpp/participant-api-contracts/identifiers"
import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  original: vi.fn(),
  render: vi.fn(),
  decrypt: vi.fn(),
  log: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireAdminSession: mocks.auth }))
vi.mock("@/lib/firestore", () => ({ firestore: {} }))
vi.mock("@/lib/logger", () => ({ logDocumentReissueFailure: mocks.log }))
vi.mock("@aerpp/config/server/admin", () => ({
  env: {
    participantApiServerId: "server-1",
    identifierHashSecret: "synthetic-key",
    sessionSealPassword: "synthetic-password",
  },
}))
vi.mock("@aerpp/firestore/participant-repository", () => ({
  createParticipantRepository: () => ({
    participationEvent: () => ({ get: mocks.get }),
    accessEvent: () => ({ create: mocks.create, update: mocks.update }),
  }),
}))
vi.mock("./document-archive", () => ({ loadDocumentOriginal: mocks.original }))
vi.mock("@aerpp/documents/pdf", () => ({
  readDocumentFont: async () => new Uint8Array([1]),
  renderDocumentPdf: mocks.render,
}))
vi.mock("@/features/research/export-email", () => ({
  decryptExportEmail: mocks.decrypt,
}))

import { reissueParticipantDocumentAction } from "./actions-document-reissue"

const pseudonym = deriveParticipantPseudonym(
  "synthetic@example.invalid",
  "synthetic-key",
)
const reference = { version: "1.0", sha256: "a".repeat(64) }
const record = {
  pseudonym,
  serverId: "server-1",
  eventType: "consent",
  consentId: "consent-1",
  encryptedEmail: "private-ciphertext",
  consentConfirmedAt: "2026-03-20T15:00:00Z",
  documentSet: reference,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { email: "operator@example.invalid" } })
  mocks.get.mockResolvedValue({ data: () => record })
  mocks.original.mockResolvedValue(new Uint8Array([1]))
  mocks.decrypt.mockResolvedValue("synthetic@example.invalid")
  mocks.render.mockResolvedValue(new Uint8Array([1, 2, 3]))
})
it("reissues the original event with durable pseudonymous audit and no research mutation", async () => {
  const result = await reissueParticipantDocumentAction({
    pseudonym,
    recordId: "consent-1",
    name: "receipt",
  })
  expect(result.ok).toBe(true)
  expect(mocks.original).toHaveBeenCalledWith(reference, "consent.pdf")
  expect(mocks.render.mock.calls[0][3]).toMatchObject({
    email: "synthetic@example.invalid",
    date: "2026年3月21日",
    documentId: expect.stringMatching(/^aerpp:did-[a-f0-9]{32}$/),
  })
  expect(mocks.create.mock.calls[0][0]).toMatchObject({
    eventType: "document_reissue",
    recordId: "consent-1",
    documentSet: reference,
    outcome: "requested",
    actorId: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: "generated" }),
  )
  expect(JSON.stringify(mocks.create.mock.calls)).not.toMatch(
    /@|ciphertext|password/,
  )
  expect(JSON.stringify(result)).not.toMatch(/@|ciphertext|password/)
})
it("records failure and never substitutes a current template for missing originals", async () => {
  mocks.original.mockRejectedValue(new Error("synthetic storage failure"))
  expect(
    (
      await reissueParticipantDocumentAction({
        pseudonym,
        recordId: "consent-1",
        name: "receipt",
      })
    ).ok,
  ).toBe(false)
  expect(mocks.render).not.toHaveBeenCalled()
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: "failed" }),
  )
})
it.each([
  { pseudonym: `aerpp:pid-${"0".repeat(32)}` },
  { serverId: "other-server" },
])(
  "rejects foreign history %j before generating or auditing a copy",
  async (changed) => {
    mocks.get.mockResolvedValue({ data: () => ({ ...record, ...changed }) })
    expect(
      (
        await reissueParticipantDocumentAction({
          pseudonym,
          recordId: "consent-1",
          name: "receipt",
        })
      ).ok,
    ).toBe(false)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.original).not.toHaveBeenCalled()
  },
)
it("does not emit a copy if its audit write cannot be confirmed", async () => {
  mocks.create.mockRejectedValue(new Error("synthetic write failure"))
  expect(
    (
      await reissueParticipantDocumentAction({
        pseudonym,
        recordId: "consent-1",
        name: "receipt",
      })
    ).ok,
  ).toBe(false)
  expect(mocks.render).not.toHaveBeenCalled()
})
it("preserves the Admin authentication redirect", async () => {
  mocks.auth.mockRejectedValue(new Error("auth redirect"))
  await expect(reissueParticipantDocumentAction({})).rejects.toThrow(
    "auth redirect",
  )
  expect(mocks.get).not.toHaveBeenCalled()
})

it("never overwrites generated audit evidence after its acknowledgement is lost", async () => {
  mocks.update.mockRejectedValueOnce(
    new Error("generated acknowledgement lost"),
  )
  const result = await reissueParticipantDocumentAction({
    pseudonym,
    recordId: "consent-1",
    name: "receipt",
  })
  expect(result.ok).toBe(false)
  expect(mocks.render).toHaveBeenCalledOnce()
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ outcome: "generated" }),
  )
})
