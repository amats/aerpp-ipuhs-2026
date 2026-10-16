import {
  DOCUMENT_MAX_BYTES,
  documentBucket,
  documentObjectName,
  verifyDocumentFile,
  verifyDocumentSet,
} from "@aerpp/config/document-set"
import type { Runtime } from "@aerpp/config/support"
import {
  DocumentSetReferenceSchema,
  ReadDocumentOriginalRequestSchema,
} from "@aerpp/participant-api-contracts/participant-api"
import { GoogleAuth } from "google-auth-library"
import { throwApiError } from "./api-errors.js"
import { parseApiRequest } from "./api-request.js"
import { getParticipantRepository } from "./storage.js"

export async function readDocumentOriginal(
  value: unknown,
  runtime: Runtime,
  read?: (name: string) => Promise<Uint8Array>,
) {
  const request = parseApiRequest(ReadDocumentOriginalRequestSchema, value)
  const record = (
    await getParticipantRepository().participationEvent(request.recordId).get()
  ).data()
  if (
    !record ||
    record.pseudonym !== request.pseudonym ||
    ["consent", "withdrawal"].includes(record.eventType) !== true
  )
    throwApiError(404, "DOCUMENT_NOT_FOUND", "document record not found")
  if (
    (request.name === "consent.pdf" && record.eventType !== "consent") ||
    (request.name === "withdrawal.pdf" && record.eventType !== "withdrawal")
  )
    throwApiError(404, "DOCUMENT_NOT_FOUND", "document purpose conflicts")
  const reference = DocumentSetReferenceSchema.parse(record.documentSet)
  let reader = read
  if (reader === undefined) {
    // Local/emulator execution must never fall back to real cloud credentials.
    if (runtime.environment === "local")
      throwApiError(
        503,
        "DOCUMENT_ARCHIVE_UNAVAILABLE",
        "document archive unavailable",
      )
    const bucket = documentBucket(runtime.projectId)
    const client = await new GoogleAuth({
      projectId: runtime.projectId,
      scopes: ["https://www.googleapis.com/auth/devstorage.read_only"],
    }).getClient()
    reader = async (name) => {
      const response = await client.request<ArrayBuffer>({
        url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
        responseType: "arraybuffer",
        timeout: 15_000,
        maxContentLength: DOCUMENT_MAX_BYTES,
      })
      const bytes = new Uint8Array(response.data)
      if (bytes.length > DOCUMENT_MAX_BYTES)
        throw new Error("Document archive size exceeded")
      return bytes
    }
  }
  const manifestJson = new TextDecoder("utf-8", { fatal: true }).decode(
    await reader(documentObjectName(reference.sha256)),
  )
  const manifest = verifyDocumentSet(manifestJson, reference)
  const bytes = verifyDocumentFile(
    manifest,
    request.name,
    await reader(documentObjectName(reference.sha256, request.name)),
  )
  return {
    ok: true as const,
    documentSet: reference,
    manifestJson,
    contentBase64: Buffer.from(bytes).toString("base64"),
  }
}
