import { createHash } from "node:crypto"
import { z } from "zod"

export const DOCUMENT_FILES = Object.freeze([
  "welcome.mdx",
  "explanation.mdx",
  "consent.mdx",
  "withdrawal.mdx",
  "explanation.pdf",
  "consent.pdf",
  "withdrawal.pdf",
  "plan.pdf",
])
export const DOCUMENT_MAX_BYTES = 20_000_000
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const versionSchema = z
  .string()
  .regex(/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/)
  .max(32)
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: versionSchema,
    files: z
      .array(
        z
          .object({
            name: z.enum(DOCUMENT_FILES),
            size: z.number().int().positive().max(DOCUMENT_MAX_BYTES),
            sha256: digestSchema,
          })
          .strict(),
      )
      .length(DOCUMENT_FILES.length),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.files.map((file) => file.name)).size ===
      DOCUMENT_FILES.length,
  )

export function documentDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
// Manifest fields contain only ASCII names, numbers and digests. Object key order
// follows JCS; supplied PDF/MDX bytes themselves are never normalized.
function canonicalJson(value) {
  if (Array.isArray(value) === true)
    return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}
export function createDocumentSet(version, files) {
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    version,
    files: DOCUMENT_FILES.map((name) => {
      const bytes = files[name]
      if (!(bytes instanceof Uint8Array))
        throw new Error("Missing document original")
      return { name, size: bytes.byteLength, sha256: documentDigest(bytes) }
    }).sort((a, b) => a.name.localeCompare(b.name, "en")),
  })
  const json = canonicalJson(manifest)
  return {
    manifest,
    json,
    reference: { version: manifest.version, sha256: documentDigest(json) },
  }
}
export function documentObjectName(sha256, name = "manifest.json") {
  digestSchema.parse(sha256)
  if (name !== "manifest.json" && DOCUMENT_FILES.includes(name) !== true)
    throw new Error("Invalid document name")
  return `document-sets/jcs-v1/sha256/${sha256}/${name}`
}
export function verifyDocumentSet(source, reference) {
  digestSchema.parse(reference.sha256)
  versionSchema.parse(reference.version)
  if (typeof source !== "string" || Buffer.byteLength(source) > 20_000)
    throw new Error("Invalid document manifest size")
  const manifest = manifestSchema.parse(JSON.parse(source))
  if (
    canonicalJson(manifest) !== source ||
    documentDigest(source) !== reference.sha256 ||
    manifest.version !== reference.version
  )
    throw new Error("Document set integrity mismatch")
  return manifest
}
export function verifyDocumentFile(manifest, name, bytes) {
  const file = manifest.files.find((file) => file.name === name)
  if (
    !file ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== file.size ||
    documentDigest(bytes) !== file.sha256
  )
    throw new Error("Document original integrity mismatch")
  return bytes
}
export function documentBucket(project) {
  if (
    typeof project !== "string" ||
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) !== true
  )
    throw new Error("Explicit document project required")
  return `${project}-documents`
}
