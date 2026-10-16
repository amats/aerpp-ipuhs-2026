/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest"

async function importDocumentUtils({
  mammothExtractRawText = vi.fn(async () => ({ value: "" })),
}: {
  mammothExtractRawText?: ReturnType<typeof vi.fn>
} = {}) {
  vi.resetModules()
  vi.doMock("mammoth", () => ({
    extractRawText: mammothExtractRawText,
  }))

  const module = await import("./document-file-extraction")
  const core = await import("./document-extraction-core")
  return {
    ...module,
    extractPptxTextFromXml: core.extractPptxTextFromXml,
    extractDocxText: async (file: File) =>
      core.extractDocxContent(await file.arrayBuffer()),
    extractPptxText: async (file: File) =>
      core.extractPptxContent(await file.arrayBuffer()),
    mammothExtractRawText,
  }
}

describe("document file extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("treats text mime types and known text extensions as plain text", async () => {
    const { isPlainTextFile } = await importDocumentUtils()

    expect(
      isPlainTextFile(
        new File(["hello"], "notes.bin", { type: "text/plain" }),
        "notes.bin",
      ),
    ).toBe(true)
    expect(
      isPlainTextFile(
        new File(["hello"], "notes.MD", { type: "" }),
        "notes.md",
      ),
    ).toBe(true)
    expect(
      isPlainTextFile(
        new File(["hello"], "notes", { type: "application/octet-stream" }),
        "notes",
      ),
    ).toBe(false)
  })

  it("rejects oversized plain text before reading while allowing media-sized Office input", async () => {
    const { validateImportFile } = await importDocumentUtils()
    const text = new File([new Uint8Array(1_000_001)], "large.txt")
    const read = vi.spyOn(text, "text")
    expect(() => validateImportFile(text)).toThrow("File too large")
    expect(read).not.toHaveBeenCalled()
    const presentation = new File([text], "normal.pptx")
    expect(() => validateImportFile(presentation)).not.toThrow()
  })

  it("extracts visible text from pptx slide xml with and without namespace prefixes", async () => {
    const { extractPptxTextFromXml } = await importDocumentUtils()

    expect(
      extractPptxTextFromXml(
        '<a:root xmlns:a="urn:test"><a:t> First </a:t><a:t>Second</a:t></a:root>',
      ),
    ).toBe("First Second")
    expect(
      extractPptxTextFromXml(
        "<root><p><t>Alpha</t></p><p><t>Beta</t></p></root>",
      ),
    ).toBe("Alpha\nBeta")
  })

  it("preserves text order across drawing namespace aliases", async () => {
    const { extractPptxTextFromXml } = await importDocumentUtils()
    expect(
      extractPptxTextFromXml(
        '<slide xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:drawing="http://schemas.openxmlformats.org/drawingml/2006/main"><drawing:t>First </drawing:t><a:t>Second </a:t><drawing:t>Third</drawing:t></slide>',
      ),
    ).toBe("First Second Third")
  })

  it("rejects malformed slide XML instead of silently dropping its text", async () => {
    const { extractPptxTextFromXml } = await importDocumentUtils()
    expect(() =>
      extractPptxTextFromXml("<root><t>Important text</root>"),
    ).toThrow("Invalid PPTX XML")
  })

  it("keeps numeric and word fragments together across formatting runs", async () => {
    const { extractPptxTextFromXml } = await importDocumentUtils()
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sp><p:txBody><a:bodyPr/><a:lstStyle/>
        <a:p><a:r><a:t>対象者は1</a:t></a:r><a:r><a:rPr b="1"/><a:t>0名です。</a:t></a:r></a:p>
        <a:p><a:r><a:t>informed </a:t></a:r><a:r><a:t>con</a:t></a:r><a:r><a:rPr i="1"/><a:t>sent</a:t></a:r></a:p>
      </p:txBody></p:sp>
    </p:sld>`
    expect(extractPptxTextFromXml(xml)).toBe(
      "対象者は10名です。\ninformed consent",
    )
  })

  it("preserves paragraph boundaries, explicit breaks, and field text", async () => {
    const { extractPptxTextFromXml } = await importDocumentUtils()
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sp><p:txBody><d:bodyPr/><d:lstStyle/>
        <d:p><d:r><d:t>説明</d:t></d:r><d:br/><d:r><d:t>本文</d:t></d:r></d:p>
        <d:p/>
        <d:p><d:r><d:t>ページ </d:t></d:r><d:fld id="synthetic"><d:t>2</d:t></d:fld></d:p>
      </p:txBody></p:sp>
    </p:sld>`
    expect(extractPptxTextFromXml(xml)).toBe("説明\n本文\n\nページ 2")
  })

  it("normalizes extracted text whitespace and line endings", async () => {
    const { normalizeExtractedText } = await importDocumentUtils()

    expect(normalizeExtractedText("\u00a0A\r\nB\rC \n")).toBe("A\nB\nC")
  })

  it("normalizes raw text returned from mammoth for docx files", async () => {
    const mammothExtractRawText = vi.fn(async () => ({
      value: "  Alpha\r\nBeta\u00a0",
    }))
    const { extractDocxText } = await importDocumentUtils({
      mammothExtractRawText,
    })

    const { default: JSZip } = await import("jszip")
    const zip = new JSZip()
    zip.file("word/document.xml", "<document/>")
    const file = new File(
      [await zip.generateAsync({ type: "arraybuffer" })],
      "sample.docx",
      {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    )

    await expect(extractDocxText(file)).resolves.toBe("Alpha\nBeta")
    expect(mammothExtractRawText).toHaveBeenCalledWith({
      arrayBuffer: expect.any(ArrayBuffer),
    })
  })

  async function createPresentation({
    target = "slides/slide1.xml",
    targetMode = "Internal",
    omitSlide = false,
    omitRelationships = false,
    malformed = false,
    malformedSlide = false,
  } = {}) {
    const { default: JSZip } = await import("jszip")
    const zip = new JSZip()
    zip.file(
      "ppt/presentation.xml",
      malformed
        ? "<broken"
        : `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p14="urn:sections"><p:sldIdLst><p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:extLst><p14:sldIdLst><p14:sldId id="257"/></p14:sldIdLst></p:extLst></p:presentation>`,
    )
    if (!omitRelationships) {
      zip.file(
        "ppt/_rels/presentation.xml.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${target}" TargetMode="${targetMode}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="/ppt/slides/slide2.xml"/></Relationships>`,
      )
    }
    if (!omitSlide)
      zip.file(
        "ppt/slides/slide1.xml",
        malformedSlide
          ? "<root><t>SECOND slide</root>"
          : "<root><t>SECOND slide</t></root>",
      )
    zip.file("ppt/slides/slide2.xml", "<root><t>FIRST slide</t></root>")
    zip.file("ppt/slides/slide3.xml", "<root><t>unreferenced slide</t></root>")
    const bytes = await zip.generateAsync({ type: "arraybuffer" })
    return new File([bytes], "reordered.pptx")
  }

  it("uses presentation order, ignoring section IDs and unreferenced slide parts", async () => {
    const { extractPptxText } = await importDocumentUtils()
    await expect(extractPptxText(await createPresentation())).resolves.toBe(
      "FIRST slide\nSECOND slide",
    )
  })

  it.each([
    { omitSlide: true },
    { omitRelationships: true },
    { malformed: true },
    { malformedSlide: true },
    { targetMode: "External" },
    { target: "https://example.com/slide.xml" },
  ])(
    "rejects a presentation whose slide order cannot be safely resolved: %o",
    async (options) => {
      const { extractPptxText } = await importDocumentUtils()
      await expect(
        extractPptxText(await createPresentation(options)),
      ).rejects.toThrow()
    },
  )
})
