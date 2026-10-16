import { setImmediate as yieldWork } from "node:timers/promises"
import { crc32 } from "node:zlib"
import { EXPORT_CONSTRAINTS as limits } from "./export-constraints"

// ZIP stored entries keep a single snapshot's JSON, CSV and dictionary together.
export function exportArchive(
  files: Record<string, string>,
  checksums?: Map<string, number>,
): Buffer {
  const entries: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const filename = Buffer.from(name)
    const data = Buffer.from(content)
    const checksum = checksums?.get(name) ?? crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(33, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(filename.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE(offset, 42)
    entries.push(local, filename, data)
    directory.push(central, filename)
    offset += local.length + filename.length + data.length
  }
  const footer = Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50, 0)
  footer.writeUInt16LE(Object.keys(files).length, 8)
  footer.writeUInt16LE(Object.keys(files).length, 10)
  footer.writeUInt32LE(
    directory.reduce((n, chunk) => n + chunk.length, 0),
    12,
  )
  footer.writeUInt32LE(offset, 16)
  return Buffer.concat([...entries, ...directory, footer])
}

export async function exportDownloadArchive(
  files: Record<string, string>,
  signal: AbortSignal,
) {
  const checksums = new Map<string, number>()
  let bytes = 0
  for (const [name, content] of Object.entries(files)) {
    signal.throwIfAborted()
    bytes += Buffer.byteLength(content) + Buffer.byteLength(name) * 2 + 76
    if (bytes > limits.maxFileBytes) throw new Error("Export capacity exceeded")
    const data = Buffer.from(content)
    let checksum = 0
    for (let start = 0; start < data.length; start += 64 * 1024) {
      checksum = crc32(data.subarray(start, start + 64 * 1024), checksum)
      if (start % (1024 * 1024) === 0) {
        await yieldWork()
        signal.throwIfAborted()
      }
    }
    checksums.set(name, checksum)
  }
  await yieldWork()
  signal.throwIfAborted()
  const archive = exportArchive(files, checksums)
  await yieldWork()
  signal.throwIfAborted()
  return archive
}
