import JSZip from "jszip"
import { beforeEach, expect, it, vi } from "vitest"
import { openOfficeArchive } from "./document-archive"
import {
  extractDocxContent,
  extractPptxContent,
} from "./document-extraction-core"
import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"
import { parseOfficeXml } from "./document-import-xml"

const { extractRawText } = vi.hoisted(() => ({ extractRawText: vi.fn() }))
vi.mock("mammoth", () => ({ extractRawText }))
beforeEach(() =>
  extractRawText.mockReset().mockResolvedValue({ value: "normal document" }),
)

function directory(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const end = buffer.byteLength - 22
  const entries: number[] = []
  let cursor = view.getUint32(end + 16, true)
  while (cursor < end) {
    entries.push(cursor)
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true)
  }
  return { view, end, entries }
}

function bytes(zip: JSZip) {
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

async function presentation(targets: string[], text = "normal slide") {
  const zip = new JSZip()
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst>${targets.map((_target, i) => `<p:sldId id="${i}" r:id="r${i}"/>`).join("")}</p:sldIdLst></p:presentation>`,
  )
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships>${targets.map((target, i) => `<Relationship Id="r${i}" Type="urn:office/slide" Target="${target}"/>`).join("")}</Relationships>`,
  )
  for (const target of targets) {
    const path = new URL(
      target,
      "https://pptx.invalid/ppt/presentation.xml",
    ).pathname.slice(1)
    zip.file(path, `<root><p><t>${text}</t></p></root>`)
  }
  return bytes(zip)
}

it("rejects the original repeated-slide expansion and equivalent target aliases", async () => {
  await expect(
    extractPptxContent(
      await presentation(
        Array(200).fill("slides/slide1.xml"),
        "x".repeat(1000),
      ),
    ),
  ).rejects.toThrow("Repeated")
  await expect(
    extractPptxContent(
      await presentation(["slides/slide1.xml", "/ppt/slides/./slide1.xml"]),
    ),
  ).rejects.toThrow("Repeated")
})

it("bounds unique slide count and cumulative text without truncating", async () => {
  await expect(
    extractPptxContent(
      await presentation(
        Array.from(
          { length: limits.maxSlides + 1 },
          (_, i) => `slides/${i}.xml`,
        ),
      ),
    ),
  ).rejects.toThrow("Too many slides")
  await expect(
    extractPptxContent(
      await presentation(["slides/1.xml", "slides/2.xml"], "x".repeat(70000)),
    ),
  ).rejects.toThrow("Text too large")
  await expect(
    extractPptxContent(
      await presentation(["slides/1.xml", "slides/2.xml"], "text"),
    ),
  ).resolves.toBe("text\ntext")
})

it("rejects excessive archive entry counts", async () => {
  const zip = new JSZip()
  for (let i = 0; i <= limits.maxArchiveEntries; i++) zip.file(`part-${i}`, "")
  await expect(openOfficeArchive(await bytes(zip))).rejects.toThrow()
})

it("seeks only to needed PPTX XML while skipping large media and unrelated XML", async () => {
  const zip = await JSZip.loadAsync(await presentation(["slides/slide1.xml"]))
  zip.file("ppt/media/large-image.bin", new Uint8Array(40 * 1024 * 1024), {
    compression: "STORE",
  })
  zip.file("ppt/unreferenced.xml", `<invalid/${"x".repeat(limits.maxXmlBytes)}`)
  const buffer = await bytes(zip)
  const file = new Blob([buffer])
  const wholeRead = vi.spyOn(file, "arrayBuffer")
  const slices = vi.spyOn(file, "slice")
  expect(file.size).toBeGreaterThan(40_000_000)
  await expect(extractPptxContent(file)).resolves.toBe("normal slide")
  expect(wholeRead).not.toHaveBeenCalled()
  const readBytes = slices.mock.results.reduce(
    (sum, result) => sum + (result.value as Blob).size,
    0,
  )
  expect(readBytes).toBeLessThan(256 * 1024)
})

it("rejects underreported central directory counts and inconsistent local names", async () => {
  const zip = new JSZip().file("part-a", "a").file("part-b", "b")
  const buffer = await bytes(zip)
  const { view, end } = directory(buffer)
  view.setUint16(end + 8, 1, true)
  view.setUint16(end + 10, 1, true)
  await expect(openOfficeArchive(buffer)).rejects.toThrow()
  const other = await bytes(zip)
  new Uint8Array(other)[30] = "X".charCodeAt(0)
  const archive = await openOfficeArchive(other)
  try {
    await expect(archive.readXml("part-a")).rejects.toThrow()
  } finally {
    await archive.close()
  }
})

it("uses one directory interpretation when a comment contains a second ZIP footer", async () => {
  const normal = new JSZip().file("safe", "a")
  const commented = await normal.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    comment: "Ordinary archive comment",
  })
  const normalArchive = await openOfficeArchive(commented)
  await expect(normalArchive.readXml("safe")).resolves.toBe("a")
  await normalArchive.close()
  const first = await bytes(new JSZip().file("safe", "a"))
  const second = await bytes(new JSZip().file("evil", "b"))
  const { view, end } = directory(first)
  view.setUint16(end + 20, second.byteLength + 1, true)
  const joined = new Uint8Array(first.byteLength + second.byteLength + 1)
  joined.set(new Uint8Array(first))
  joined.set(new Uint8Array(second), first.byteLength)
  joined[joined.length - 1] = 1
  const archive = await openOfficeArchive(joined.buffer)
  try {
    expect(archive.has("evil")).toBe(false)
    await expect(archive.readXml("safe")).resolves.toBe("a")
  } finally {
    await archive.close()
  }
})

it("rejects overwritten duplicate entry names instead of checking only retained entries", async () => {
  const buffer = await bytes(
    new JSZip().file("part-a", "a").file("part-b", "b"),
  )
  const { view, entries } = directory(buffer)
  const second = entries[1]
  const local = view.getUint32(second + 42, true)
  new Uint8Array(buffer)[local + 35] = "a".charCodeAt(0)
  new Uint8Array(buffer)[second + 51] = "a".charCodeAt(0)
  await expect(openOfficeArchive(buffer)).rejects.toThrow()
})

it("limits actual decompression when an entry lies about its expanded size", async () => {
  const buffer = await bytes(
    new JSZip().file("hidden.bin", "x".repeat(limits.maxXmlBytes + 16384)),
  )
  const { view, entries } = directory(buffer)
  // Keep both headers consistent so the actual output/CRC/size checks, rather
  // than the local-header consistency check, reject the false size.
  view.setUint32(entries[0] + 24, 1, true)
  view.setUint32(view.getUint32(entries[0] + 42, true) + 22, 1, true)
  const archive = await openOfficeArchive(buffer)
  try {
    await expect(archive.readXml("hidden.bin")).rejects.toThrow()
  } finally {
    await archive.close()
  }
})

it("bounds central-directory allocation before enumerating archive entries", async () => {
  const oversized = new Uint8Array(limits.maxDirectoryBytes + 1 + 22)
  const view = new DataView(oversized.buffer)
  const end = oversized.length - 22
  view.setUint32(0, 0x02014b50, true)
  view.setUint32(end, 0x06054b50, true)
  view.setUint16(end + 8, 1, true)
  view.setUint16(end + 10, 1, true)
  view.setUint32(end + 12, end, true)
  await expect(openOfficeArchive(oversized.buffer)).rejects.toThrow(
    "ZIP directory too large",
  )
})

it("does not expose unused media or unrelated XML to the DOCX converter", async () => {
  const zip = new JSZip().file("word/document.xml", "<document/>")
  zip.file("word/media/image.png", "not an image".repeat(1000))
  zip.file("customXml/unused.xml", "<malformed")
  await extractDocxContent(await bytes(zip))
  const argument = extractRawText.mock.calls[0][0]
  const validated = await JSZip.loadAsync(argument.arrayBuffer)
  expect(Object.keys(validated.files)).toEqual(["word/document.xml"])
})

it("limits aggregate actual decompression with an underreported final entry", async () => {
  const zip = new JSZip()
  for (let i = 0; i < 9; i++)
    zip.file(`part-${i}.xml`, "x".repeat(8 * 1024 * 1024))
  const buffer = await bytes(zip)
  const { view, entries } = directory(buffer)
  view.setUint32(entries[8] + 24, 1, true)
  view.setUint32(view.getUint32(entries[8] + 42, true) + 22, 1, true)
  const archive = await openOfficeArchive(buffer)
  try {
    for (let i = 0; i < 8; i++) await archive.readXml(`part-${i}.xml`)
    await expect(archive.readXml("part-8.xml")).rejects.toThrow()
  } finally {
    await archive.close()
  }
})

it("rejects deep, oversized and entity-bearing XML before the DOCX consumer", async () => {
  for (const [name, text] of [
    ["word/document.xml", "<a>".repeat(65) + "</a>".repeat(65)],
    ["word/styles.xml", `<styles>${"x".repeat(limits.maxXmlBytes)}</styles>`],
    ["word/document.xml", '<!DOCTYPE a [<!ENTITY x "expansion">]><a>&x;</a>'],
  ]) {
    const zip = new JSZip().file(name, text)
    await expect(extractDocxContent(await bytes(zip))).rejects.toThrow()
  }
  expect(extractRawText).not.toHaveBeenCalled()
  expect(() =>
    parseOfficeXml(`<root>${"<a/>".repeat(limits.maxXmlNodes)}</root>`),
  ).toThrow("complex")
})

it("traces renamed DOCX XML parts and rejects permissive-parser prefix bypasses", async () => {
  const zip = new JSZip()
  zip.file(
    "_rels/.rels",
    '<Relationships><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/main.dat"/></Relationships>',
  )
  zip.file("word/main.dat", `prefix${"<a>".repeat(65)}${"</a>".repeat(65)}`)
  await expect(extractDocxContent(await bytes(zip))).rejects.toThrow()
  expect(extractRawText).not.toHaveBeenCalled()
  zip.file("word/main.dat", "<document/>")
  zip.file(
    "word/_rels/main.dat.rels",
    '<Relationships><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="notes.data"/></Relationships>',
  )
  zip.file("word/notes.data", "<a>".repeat(65) + "</a>".repeat(65))
  await expect(extractDocxContent(await bytes(zip))).rejects.toThrow("deep")
  expect(extractRawText).not.toHaveBeenCalled()
  zip.file("word/notes.data", "<notes/>")
  await expect(extractDocxContent(await bytes(zip))).resolves.toBe(
    "normal document",
  )
})

it("validates renamed XML related to a main DOCX part in the archive root", async () => {
  const zip = new JSZip()
  zip.file(
    "_rels/.rels",
    '<Relationships><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="main.dat"/></Relationships>',
  )
  zip.file("main.dat", "<document/>")
  zip.file(
    "_rels/main.dat.rels",
    '<Relationships><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.data"/></Relationships>',
  )
  zip.file("styles.data", "<a>".repeat(70) + "</a>".repeat(70))
  await expect(extractDocxContent(await bytes(zip))).rejects.toThrow("deep")
  expect(extractRawText).not.toHaveBeenCalled()
  zip.file("styles.data", "<styles/>")
  await expect(extractDocxContent(await bytes(zip))).resolves.toBe(
    "normal document",
  )
})

it("preserves normal DOCX normalization and rejects excess output", async () => {
  const buffer = await bytes(
    new JSZip().file("word/document.xml", "<document/>"),
  )
  extractRawText.mockResolvedValueOnce({ value: " Alpha\r\nBeta\u00a0" })
  await expect(extractDocxContent(buffer)).resolves.toBe("Alpha\nBeta")
  extractRawText.mockResolvedValueOnce({
    value: "x".repeat(limits.maxTextCodeUnits + 1),
  })
  await expect(extractDocxContent(buffer)).rejects.toThrow("Text too large")
})
