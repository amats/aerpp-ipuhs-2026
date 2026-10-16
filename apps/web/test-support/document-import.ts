import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32 } from "node:zlib"
import JSZip from "jszip"

// Create a real seekable ZIP at the requested size without allocating its media
// in memory or writing gigabytes to disk. The sparse media has a correct CRC.
export async function createSparseOfficeFile(
  kind: "docx" | "pptx",
  totalBytes: number,
  text: string,
) {
  const zip = new JSZip()
  const owner = kind === "docx" ? "word" : "ppt"
  zip.file(`${owner}/media/image1.png`, "", { createFolders: false })
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  if (kind === "docx") {
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/></Types>',
    )
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="image"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`,
    )
    zip.file(
      "word/_rels/document.xml.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    )
  } else {
    zip.file(
      "ppt/presentation.xml",
      '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId id="1" r:id="slide"/></p:sldIdLst></p:presentation>',
    )
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      '<Relationships><Relationship Id="slide" Type="urn:office/slide" Target="slides/1.xml"/></Relationships>',
    )
    zip.file("ppt/slides/1.xml", `<root><p><t>${escaped}</t></p></root>`)
  }
  const seed = await zip.generateAsync({ type: "nodebuffer" })
  const mediaBytes = totalBytes - seed.length
  if (mediaBytes < 0 || totalBytes >= 0xffffffff)
    throw new Error("Invalid sparse Office fixture size")
  const chunk = new Uint8Array(1024 * 1024)
  let checksum = 0
  for (let left = mediaBytes; left > 0; left -= chunk.length)
    checksum = crc32(chunk.subarray(0, Math.min(left, chunk.length)), checksum)
  const dataOffset = 30 + seed.readUInt16LE(26) + seed.readUInt16LE(28)
  seed.writeUInt32LE(checksum, 14)
  seed.writeUInt32LE(mediaBytes, 18)
  seed.writeUInt32LE(mediaBytes, 22)
  const end = seed.length - 22
  const directoryOffset = seed.readUInt32LE(end + 16)
  let cursor = directoryOffset
  while (cursor < end) {
    const local = seed.readUInt32LE(cursor + 42)
    if (local === 0) {
      seed.writeUInt32LE(checksum, cursor + 16)
      seed.writeUInt32LE(mediaBytes, cursor + 20)
      seed.writeUInt32LE(mediaBytes, cursor + 24)
    } else seed.writeUInt32LE(local + mediaBytes, cursor + 42)
    cursor +=
      46 +
      seed.readUInt16LE(cursor + 28) +
      seed.readUInt16LE(cursor + 30) +
      seed.readUInt16LE(cursor + 32)
  }
  seed.writeUInt32LE(directoryOffset + mediaBytes, end + 16)
  const directory = await mkdtemp(join(tmpdir(), "aerpp-office-import-"))
  const path = join(directory, `synthetic.${kind}`)
  try {
    const file = await open(path, "wx")
    try {
      await file.write(seed.subarray(0, dataOffset), 0, dataOffset, 0)
      await file.write(
        seed.subarray(dataOffset),
        0,
        seed.length - dataOffset,
        dataOffset + mediaBytes,
      )
    } finally {
      await file.close()
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    path,
    dispose: () => rm(directory, { recursive: true, force: true }),
  }
}
