export type DocumentName =
  | "welcome.mdx"
  | "explanation.mdx"
  | "consent.mdx"
  | "withdrawal.mdx"
  | "explanation.pdf"
  | "consent.pdf"
  | "withdrawal.pdf"
  | "plan.pdf"
export type DocumentSetReference = { version: string; sha256: string }
export type DocumentSetManifest = {
  schemaVersion: 1
  version: string
  files: { name: DocumentName; size: number; sha256: string }[]
}
export const DOCUMENT_FILES: readonly DocumentName[]
export const DOCUMENT_MAX_BYTES: number
export function documentDigest(bytes: Uint8Array | string): string
export function createDocumentSet(
  version: string,
  files: Record<DocumentName, Uint8Array>,
): {
  manifest: DocumentSetManifest
  json: string
  reference: DocumentSetReference
}
export function documentObjectName(
  sha256: string,
  name?: DocumentName | "manifest.json",
): string
export function verifyDocumentSet(
  source: string,
  reference: DocumentSetReference,
): DocumentSetManifest
export function verifyDocumentFile(
  manifest: DocumentSetManifest,
  name: DocumentName,
  bytes: Uint8Array,
): Uint8Array
export function documentBucket(project: string): string
