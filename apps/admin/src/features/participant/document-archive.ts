import "server-only"
import {
  DOCUMENT_FILES,
  DOCUMENT_MAX_BYTES,
  type DocumentName,
  type DocumentSetReference,
  documentBucket,
  documentObjectName,
  verifyDocumentFile,
  verifyDocumentSet,
} from "@aerpp/config/document-set"
import { env } from "@aerpp/config/server/admin"
import { GoogleAuth } from "google-auth-library"
import { awaitRead } from "@/lib/await-read"
import { googleClientOptions } from "@/lib/google-auth"

async function readOriginal(
  name: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (env.environment !== "test" && env.environment !== "production")
    throw new Error("Explicit document archive environment required")
  const bucket = documentBucket(env.gcpProjectId ?? "")
  const client =
    googleClientOptions.authClient ??
    (await awaitRead(
      new GoogleAuth({
        projectId: env.gcpProjectId,
        scopes: ["https://www.googleapis.com/auth/devstorage.read_only"],
      }).getClient(),
      signal ?? AbortSignal.timeout(45_000),
    ))
  signal?.throwIfAborted()
  const response = await client.request<ArrayBuffer>({
    url: `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
    responseType: "arraybuffer",
    signal,
    timeout: 15_000,
    maxContentLength: DOCUMENT_MAX_BYTES,
  })
  const bytes = new Uint8Array(response.data)
  if (bytes.length > DOCUMENT_MAX_BYTES)
    throw new Error("Document archive size exceeded")
  return bytes
}
export async function loadDocumentOriginal(
  reference: DocumentSetReference,
  name: DocumentName,
  read = readOriginal,
) {
  const signal = AbortSignal.timeout(45_000)
  const manifest = verifyDocumentSet(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await awaitRead(
        read(documentObjectName(reference.sha256), signal),
        signal,
      ),
    ),
    reference,
  )
  signal.throwIfAborted()
  const bytes = verifyDocumentFile(
    manifest,
    name,
    await awaitRead(
      read(documentObjectName(reference.sha256, name), signal),
      signal,
    ),
  )
  signal.throwIfAborted()
  return bytes
}
export async function verifyDocumentArchive(
  reference: DocumentSetReference,
  read = readOriginal,
) {
  const signal = AbortSignal.timeout(45_000)
  const manifest = verifyDocumentSet(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await awaitRead(
        read(documentObjectName(reference.sha256), signal),
        signal,
      ),
    ),
    reference,
  )
  signal.throwIfAborted()
  for (const name of DOCUMENT_FILES) {
    signal.throwIfAborted()
    verifyDocumentFile(
      manifest,
      name,
      await awaitRead(
        read(documentObjectName(reference.sha256, name), signal),
        signal,
      ),
    )
    signal.throwIfAborted()
  }
}
