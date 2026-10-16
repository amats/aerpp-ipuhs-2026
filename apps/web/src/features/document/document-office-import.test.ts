import { openAsBlob } from "node:fs"
import {
  TextReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js"
import JSZip from "jszip"
import { expect, it, vi } from "vitest"
import { createSparseOfficeFile } from "../../../test-support/document-import"
import { DOCUMENT_CONSTRAINTS } from "./document-constraints"
import { extractDocxContent } from "./document-docx-extraction"
import { extractPptxContent } from "./document-extraction-core"

// Vitest resolves Mammoth's Node entrypoint, whose input is Buffer. Adapt only
// that transport; execute its real DOCX reader and text converter unchanged.
vi.mock("mammoth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mammoth")>()
  return {
    extractRawText: ({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) =>
      actual.extractRawText({ buffer: Buffer.from(arrayBuffer) }),
  }
})

it.each(["docx", "pptx"] as const)(
  "imports a 2 GB %s through bounded local reads",
  async (kind) => {
    const text = "あ".repeat(DOCUMENT_CONSTRAINTS.maxTotalGraphemes)
    const fixture = await createSparseOfficeFile(kind, 2_000_000_000, text)
    try {
      const file = await openAsBlob(fixture.path)
      const wholeRead = vi.spyOn(file, "arrayBuffer")
      const slices = vi.spyOn(file, "slice")
      const extract = kind === "docx" ? extractDocxContent : extractPptxContent
      await expect(extract(file)).resolves.toBe(text)
      expect(wholeRead).not.toHaveBeenCalled()
      const bytesRead = slices.mock.results.reduce(
        (sum, result) => sum + (result.value as Blob).size,
        0,
      )
      expect(bytesRead).toBeLessThan(512 * 1024)
    } finally {
      await fixture.dispose()
    }
  },
)

it("imports 30,000 individually formatted DOCX characters beyond the old XML budget", async () => {
  const count = DOCUMENT_CONSTRAINTS.maxTotalGraphemes
  const run =
    '<w:r><w:rPr><w:b/><w:i/><w:color w:val="000000"/></w:rPr><w:t>あ</w:t></w:r>'
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${run.repeat(count)}</w:p></w:body></w:document>`
  expect(new TextEncoder().encode(xml).length).toBeGreaterThan(2 * 1024 * 1024)
  const zip = new JSZip().file("word/document.xml", xml)
  await expect(
    extractDocxContent(await zip.generateAsync({ type: "arraybuffer" })),
  ).resolves.toBe("あ".repeat(count))
})

it("keeps an over-analysis-budget draft available for editing without truncation", async () => {
  const text = "研究".repeat(20000)
  const zip = new JSZip().file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  )
  await expect(
    extractDocxContent(await zip.generateAsync({ type: "arraybuffer" })),
  ).resolves.toBe(text)
})

it("accepts ZIP64 Office metadata while keeping extraction bounded", async () => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    zip64: true,
    useWebWorkers: false,
  })
  await writer.add(
    "word/document.xml",
    new TextReader(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ZIP64 document</w:t></w:r></w:p></w:body></w:document>',
    ),
  )
  const data = await writer.close()
  await expect(extractDocxContent(new Blob([data]))).resolves.toBe(
    "ZIP64 document",
  )
})
