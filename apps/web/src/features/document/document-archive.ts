import {
  type FileEntry,
  Reader,
  ZipReader,
} from "@zip.js/zip.js/lib/zip-core-native.js"
import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"

// Bound metadata reads before the ZIP library allocates a central directory.
// All reads, including compressed-data streaming, go through bounded slices.
class OfficeBlobReader extends Reader<Blob> {
  private bytesRead = 0

  constructor(private readonly file: Blob) {
    super(file)
    this.size = file.size
  }

  async readUint8Array(offset: number, length: number) {
    if (
      Number.isSafeInteger(offset) !== true ||
      Number.isSafeInteger(length) !== true ||
      offset < 0 ||
      offset > this.size ||
      length < 0
    )
      throw new Error("Invalid ZIP range")
    if (length > limits.maxDirectoryBytes)
      throw new Error("ZIP directory too large")
    const end = Math.min(this.size, offset + length)
    this.bytesRead += end - offset
    if (this.bytesRead > limits.maxReadBytes)
      throw new Error("Office read budget exceeded")
    const buffer = await this.file.slice(offset, end).arrayBuffer()
    if (buffer.byteLength !== end - offset)
      throw new Error("Incomplete ZIP range")
    return new Uint8Array(buffer)
  }
}

async function readBoundedXml(entry: FileEntry, budget: { bytes: number }) {
  if (
    entry.encrypted === true ||
    (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) ||
    entry.compressedSize > limits.maxCompressedXmlBytes ||
    entry.uncompressedSize > limits.maxXmlBytes
  )
    throw new Error("Unsupported or oversized Office XML part")
  let length = 0
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const text: string[] = []
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        length += chunk.byteLength
        budget.bytes += chunk.byteLength
        if (
          length > limits.maxXmlBytes ||
          budget.bytes > limits.maxExpandedBytes
        )
          throw new Error("Expanded XML too large")
        text.push(decoder.decode(chunk, { stream: true }))
      },
    }),
    {
      checkCrc32: true,
      checkOverlappingEntry: true,
    },
  )
  text.push(decoder.decode())
  return text.join("")
}

export async function openOfficeArchive(source: Blob | ArrayBuffer) {
  const file = source instanceof ArrayBuffer ? new Blob([source]) : source
  if (Number.isSafeInteger(file.size) !== true || file.size < 0)
    throw new Error("Invalid Office file size")
  const reader = new ZipReader(new OfficeBlobReader(file), {
    // One parser selects and validates the directory, decoded names and local
    // headers. DOCX conversion receives only a newly built, validated XML ZIP.
    strictness: "strict",
    useWebWorkers: false,
  })
  const entries = new Map<string, FileEntry>()
  let count = 0
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (++count > limits.maxArchiveEntries)
        throw new Error("Too many ZIP entries")
      const name = entry.filename
      if (
        name === "" ||
        name.startsWith("/") ||
        name.includes("//") ||
        name.includes("\\") ||
        name.split("/").some((part) => part === "." || part === "..")
      )
        throw new Error("Invalid ZIP part name")
      if (entry.directory === false) entries.set(name, entry)
    }
  } catch (error) {
    await reader.close()
    throw error
  }
  const budget = { bytes: 0 }
  const consumed = new Map<string, Promise<string>>()
  return {
    has: (name: string) => entries.has(name),
    readXml(name: string) {
      const previous = consumed.get(name)
      if (previous !== undefined) return previous
      const entry = entries.get(name)
      if (entry === undefined)
        return Promise.reject(new Error("Missing Office XML part"))
      // Cache by the resolved ZIP name so each part consumes its budget once.
      const pending = readBoundedXml(entry, budget)
      consumed.set(name, pending)
      return pending
    },
    close: () => reader.close(),
  }
}
