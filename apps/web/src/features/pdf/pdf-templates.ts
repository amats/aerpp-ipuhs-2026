import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  type DocumentSetReference,
  verifyDocumentFile,
  verifyDocumentSet,
} from "@aerpp/config/document-set"
import { readDocumentFont } from "@aerpp/documents/pdf"
import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import {
  bundledResearchAssetsDirectory,
  readResearchDocumentSet,
} from "@/lib/research-assets.mjs"

type PdfTemplateName = "explanation" | "plan" | "consent" | "withdrawal"

export async function readPdfTemplate(
  name: PdfTemplateName,
): Promise<Uint8Array> {
  return readCurrentOriginal(name, readDisplayedDocumentSet())
}
async function readCurrentOriginal(
  name: PdfTemplateName,
  reference: DocumentSetReference,
): Promise<Uint8Array> {
  const directory = bundledResearchAssetsDirectory(process.cwd())
  const artifact = readResearchDocumentSet(process.cwd(), directory)
  const manifest = verifyDocumentSet(artifact.json, reference)
  return verifyDocumentFile(
    manifest,
    `${name}.pdf`,
    await readFile(path.join(directory, `${name}.pdf`)),
  )
}

export function readPdfFont(): Promise<Uint8Array> {
  // next.config.ts traces the shared font explicitly, without tracing the workspace.
  return readDocumentFont(
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../.."),
  )
}

export async function readRecordedPdfTemplate(
  name: PdfTemplateName,
  record: { id: string; pseudonym: string; documentSet: DocumentSetReference },
): Promise<Uint8Array> {
  if (record.documentSet.sha256 === readDisplayedDocumentSet().sha256) {
    return readCurrentOriginal(name, record.documentSet)
  }

  const { env } = await import("@aerpp/config/server/web")
  const { participantApiHeaders } = await import(
    "@/lib/participant-api-headers"
  )
  const { safeParseApiSuccess } = await import(
    "@/lib/participant-api-contract-helpers"
  )
  const response = await fetch(env.readDocumentOriginalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...participantApiHeaders() },
    body: JSON.stringify({
      pseudonym: record.pseudonym,
      recordId: record.id,
      name: `${name}.pdf`,
    }),
    // Support reads the manifest and PDF sequentially, each with a 15s limit.
    signal: AbortSignal.timeout(65_000),
    cache: "no-store",
  })
  const parsed = safeParseApiSuccess(
    "readDocumentOriginal",
    await response.json(),
  )
  if (
    response.ok !== true ||
    parsed.success !== true ||
    parsed.data.documentSet.sha256 !== record.documentSet.sha256
  )
    throw new Error("Document original unavailable")
  const manifest = verifyDocumentSet(
    parsed.data.manifestJson,
    record.documentSet,
  )
  return verifyDocumentFile(
    manifest,
    `${name}.pdf`,
    Buffer.from(parsed.data.contentBase64, "base64"),
  )
}
