import { env } from "@aerpp/config/server/web"
import { deriveParticipantPseudonym } from "@aerpp/participant-api-contracts/identifiers"
import { expect, it, vi } from "vitest"
import {
  accessFiles,
  buildAccessExport,
} from "../../admin/src/features/research/research-export"
import type { SourceDocument } from "../../admin/src/features/research/research-types"
import { fixtureSource } from "../../admin/test-support/research-fixtures"
import {
  generateConsentPdf,
  generateWithdrawalPdf,
} from "../src/features/pdf/generate-pdf"

const mocks = vi.hoisted(() => ({ records: vi.fn(), fill: vi.fn() }))
vi.mock("@/features/auth/auth-service", () => ({
  listParticipationEvents: mocks.records,
}))
vi.mock("@/features/auth/email", () => ({
  decryptEmail: async () => "user@example.invalid",
}))
vi.mock("@/features/pdf/pdf-templates", () => ({
  readRecordedPdfTemplate: async () => new Uint8Array(),
  readPdfFont: async () => new Uint8Array(),
}))
vi.mock("@/features/pdf/fill-participant-pdf", () => ({
  fillParticipantPdf: mocks.fill,
}))

it("exports the same DID written by Web PDFs across devices, JST dates and re-consent boundaries", async () => {
  const email = " ＵＳＥＲ@ＥＸＡＭＰＬＥ.invalid "
  const pseudonym = deriveParticipantPseudonym(email, env.identifierHashSecret)
  const documentSet = { version: "1.0", sha256: "a".repeat(64) }
  const history = [
    { id: "first", eventType: "consent", at: "2026-03-20T15:00:00Z" },
    {
      id: "device-document",
      consentId: "device",
      eventType: "consent",
      at: "2026-03-22T00:00:00Z",
    },
    { id: "same-day", eventType: "consent", at: "2026-03-22T01:00:00Z" },
    {
      id: "withdrawal-1",
      eventType: "withdrawal",
      consentId: "device",
      at: "2026-03-23T15:00:00Z",
    },
    {
      id: "renewed",
      eventType: "consent",
      precedingWithdrawalId: "withdrawal-1",
      at: "2026-03-23T15:00:00Z",
    },
    {
      id: "renewed-device",
      eventType: "consent",
      precedingWithdrawalId: "withdrawal-1",
      at: "2026-03-25T00:00:00Z",
    },
    {
      id: "withdrawal-2",
      eventType: "withdrawal",
      consentId: "renewed",
      at: "2026-03-26T00:00:00Z",
    },
    {
      id: "withdrawal-repeat",
      eventType: "withdrawal",
      consentId: "renewed-device",
      at: "2026-03-27T00:00:00Z",
    },
  ]
  const webRecords = history.map((record) => ({
    ...record,
    pseudonym,
    documentSet,
    encryptedEmail: "synthetic-ciphertext",
    eventAt: new Date(Date.parse(record.at) + 123),
  }))
  const participationEvents: SourceDocument[] = history.map(
    (record, index) => ({
      id: record.id,
      data: {
        pseudonym,
        documentSet,
        encryptedEmail: "synthetic-ciphertext",
        serverId: `server-${index % 2}`,
        dataPurpose: index % 2 === 0 ? "research" : "test",
        eventType: record.eventType,
        ...(record.consentId ? { consentId: record.consentId } : {}),
        precedingWithdrawalId: record.precedingWithdrawalId ?? null,
        [record.eventType === "consent"
          ? "consentConfirmedAt"
          : "withdrawalAcceptedAt"]: {
          seconds: Date.parse(record.at) / 1000,
          nanoseconds: 123456789,
        },
      },
    }),
  )
  const source = {
    ...fixtureSource(),
    participationEvents: [...participationEvents].reverse(),
    emailConfirmations: [],
  }
  const access = await buildAccessExport(
    source,
    async () => email,
    env.identifierHashSecret,
  )
  const files = accessFiles(access)
  for (const record of history) {
    mocks.records.mockResolvedValue([...webRecords].reverse())
    const consentId = record.consentId ?? record.id
    const pdf = await (record.eventType === "consent"
      ? generateConsentPdf(email, consentId)
      : generateWithdrawalPdf(email, consentId, record.id))
    const exported = access.participationEvents.find(
      (row) => row.id === record.id,
    )
    expect(exported?.data.did).toBe(pdf.documentId)
    expect(pdf.documentId).toMatch(/^aerpp:did-[A-Za-z0-9]{32}$/)
    expect(files["participation-events.csv"]).toContain(pdf.documentId)
    expect(files["source.json"]).toContain(pdf.documentId)
    expect(mocks.fill).toHaveBeenLastCalledWith(
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      expect.objectContaining({ documentId: exported?.data.did }),
    )
  }
  const did = (id: string) =>
    access.participationEvents.find((row) => row.id === id)?.data.did
  expect(did("first")).not.toBe(did("device-document"))
  expect(did("device-document")).toBe(did("same-day"))
  expect(did("renewed")).not.toBe(did("renewed-device"))
  expect(did("first")).not.toBe(did("renewed"))
  expect(did("withdrawal-1")).not.toBe(did("renewed"))
  expect(did("withdrawal-2")).not.toBe(did("withdrawal-repeat"))
  mocks.records.mockResolvedValue([...webRecords].reverse())
  for (const sessionConsentId of ["first", "device", "same-day"]) {
    const pdf = await generateConsentPdf(email, sessionConsentId)
    expect(pdf.documentId).toBe(
      did(sessionConsentId === "device" ? "device-document" : sessionConsentId),
    )
    expect(mocks.fill).toHaveBeenLastCalledWith(
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      expect.objectContaining({
        date: sessionConsentId === "first" ? "2026年3月21日" : "2026年3月22日",
      }),
    )
  }
  const renewedPdf = await generateConsentPdf(email, "renewed")
  expect(renewedPdf.documentId).toBe(did("renewed"))
  expect((await generateConsentPdf(email, "renewed")).documentId).toBe(
    renewedPdf.documentId,
  )
  expect(JSON.stringify(access)).not.toContain(env.identifierHashSecret)
  expect(
    source.participationEvents.every((row) => !Object.hasOwn(row.data, "did")),
  ).toBe(true)
})
