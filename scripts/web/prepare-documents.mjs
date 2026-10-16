import assert from "node:assert/strict"
import { readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  documentBucket,
  documentDigest,
  documentObjectName,
} from "@aerpp/config/document-set"
import { environmentTarget } from "@aerpp/config/targets"
import {
  cloudEnvironment,
  gcloud,
  outputDirectory,
  privateJson,
} from "../shared/delivery.mjs"
import { readImageDocumentSet } from "./image-documents.mjs"

export async function registerDocumentObject(
  bucket,
  name,
  bytes,
  token,
  request = fetch,
) {
  const headers = { Authorization: `Bearer ${token}` }
  const upload = await request(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (upload.ok !== true && upload.status !== 412)
    throw new Error("Document registration failed")
  const stored = await request(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
    { headers, signal: AbortSignal.timeout(30_000) },
  )
  if (
    stored.ok !== true ||
    documentDigest(new Uint8Array(await stored.arrayBuffer())) !==
      documentDigest(bytes)
  )
    throw new Error("Document registration verification failed")
}
export function assertDocumentRegistration(receipt, image, project) {
  assert.equal(receipt?.version, 1, "Register documents before exporting Web")
  assert.equal(receipt.project, project)
  assert.equal(receipt.bucket, documentBucket(project))
  assert.equal(receipt.imageId, image.imageId)
  assert.deepEqual(receipt.documentSet, image.documentSet)
  assert.match(receipt.documentSet.sha256, /^[a-f0-9]{64}$/)
}
export async function main(args = process.argv.slice(2)) {
  const [environment, option, ...extra] = args
  cloudEnvironment(environment)
  if (extra.length > 0 || (option !== undefined && option !== "--apply"))
    throw new Error("Usage: web:prepare-documents test|production [--apply]")
  const target = environmentTarget(environment)
  const output = outputDirectory(environment)
  const receiptPath = resolve(output, "web-documents.json")
  if (option === "--apply") rmSync(receiptPath, { force: true })
  const image = JSON.parse(
    readFileSync(resolve(output, "web-image.json"), "utf8"),
  )
  const checked = JSON.parse(
    readFileSync(resolve(output, "web-image-check.json"), "utf8"),
  )
  assert.equal(image.environment, environment)
  assert.equal(checked.project, target.project)
  assert.equal(checked.imageId, image.imageId)
  assert.equal(checked.publicPages, true)
  assert.equal(checked.buildInputSha256, image.buildInputSha256)
  const artifact = readImageDocumentSet(image.imageId)
  assert.deepEqual(artifact.reference, image.documentSet)
  if (option !== "--apply") {
    console.log(
      "Image documents verified; use --apply to register the selected archive",
    )
    return
  }
  const bucket = documentBucket(target.project)
  const token = gcloud(target.project, ["auth", "print-access-token"])
  for (const [name, bytes] of Object.entries(artifact.files))
    await registerDocumentObject(
      bucket,
      documentObjectName(artifact.reference.sha256, name),
      bytes,
      token,
    )
  await registerDocumentObject(
    bucket,
    documentObjectName(artifact.reference.sha256),
    new TextEncoder().encode(artifact.json),
    token,
  )
  privateJson(receiptPath, {
    version: 1,
    _comment:
      "Generated; do not edit. Verified document registration for this immutable Web image.",
    project: target.project,
    bucket,
    imageId: image.imageId,
    documentSet: artifact.reference,
  })
  console.log("Image document set registered and verified")
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Document preparation failed; verify selected environment, image checks and archive access",
    )
    process.exitCode = 1
  })
