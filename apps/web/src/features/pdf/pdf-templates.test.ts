import path from "node:path"
import {
  createDocumentSet,
  DOCUMENT_FILES,
  type DocumentName,
} from "@aerpp/config/document-set"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn() }))
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }))
vi.mock("@/lib/research-assets.mjs", () => ({
  bundledResearchAssetsDirectory: () => "/synthetic-assets",
  readResearchDocumentSet: () => current,
}))

import { readPdfTemplate, readRecordedPdfTemplate } from "./pdf-templates"

const files = Object.fromEntries(
  DOCUMENT_FILES.map((name) => [
    name,
    new TextEncoder().encode(`synthetic ${name}`),
  ]),
) as Record<DocumentName, Uint8Array>

const current = createDocumentSet("2.0", files)
const old = createDocumentSet("1.0", files)
const record = {
  id: "owned-consent",
  pseudonym: "synthetic-owner",
  documentSet: old.reference,
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("AERPP_WEB_DOCUMENT_SET", JSON.stringify(current.reference))
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.read.mockImplementation(
    async (file: string) => files[path.basename(file) as DocumentName],
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it("verifies current originals against the compiled set before rendering", async () => {
  expect(await readPdfTemplate("consent")).toEqual(files["consent.pdf"])
  mocks.read.mockResolvedValue(new Uint8Array([0]))
  await expect(readPdfTemplate("plan")).rejects.toThrow("integrity")
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it("retrieves an older set only through its owned receipt and verifies the response bytes", async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({
      ok: true,
      documentSet: old.reference,
      manifestJson: old.json,
      contentBase64: Buffer.from(files["consent.pdf"]).toString("base64"),
    }),
  )
  expect(
    new Uint8Array(await readRecordedPdfTemplate("consent", record)),
  ).toEqual(files["consent.pdf"])
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
    pseudonym: record.pseudonym,
    recordId: record.id,
    name: "consent.pdf",
  })
  expect(mocks.read).not.toHaveBeenCalled()
})
it("rejects corrupt or substituted archive responses without current-template fallback", async () => {
  for (const patch of [
    { contentBase64: "AA==" },
    { documentSet: current.reference },
    { manifestJson: current.json },
  ]) {
    mocks.fetch.mockResolvedValue(
      Response.json({
        ok: true,
        documentSet: old.reference,
        manifestJson: old.json,
        contentBase64: Buffer.from(files["consent.pdf"]).toString("base64"),
        ...patch,
      }),
    )
    await expect(readRecordedPdfTemplate("consent", record)).rejects.toThrow()
  }
  expect(mocks.read).not.toHaveBeenCalled()
})
