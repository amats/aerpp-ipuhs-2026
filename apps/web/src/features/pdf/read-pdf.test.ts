import { renderDocumentPdf } from "@aerpp/documents/pdf"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }))
vi.mock("./pdf-templates", () => ({
  readPdfTemplate: readFileMock,
  readPdfFont: readFileMock,
}))
vi.mock("@aerpp/documents/pdf", () => ({
  renderDocumentPdf: vi.fn(async () => new Uint8Array([4, 5, 6])),
}))

import { readExplanationPdf, readPlanPdf } from "./read-pdf"

describe("read pdf templates", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["explanation", readExplanationPdf],
    ["plan", readPlanPdf],
  ] as const)(
    "adds only the document-set footer to the %s PDF",
    async (name, readPdf) => {
      const bytes = new Uint8Array([1, 2, 3])
      readFileMock.mockResolvedValue(bytes)
      await expect(readPdf()).resolves.toEqual(new Uint8Array([4, 5, 6]))
      expect(renderDocumentPdf).toHaveBeenCalledWith(bytes, bytes, {
        version: "1.0",
        sha256: "a".repeat(64),
      })
      expect(readFileMock).toHaveBeenCalledWith(name)
    },
  )
})
