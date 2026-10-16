import assert from "node:assert/strict"
import test from "node:test"
import { documentBucket } from "@aerpp/config/document-set"
import {
  assertDocumentRegistration,
  registerDocumentObject,
} from "./prepare-documents.mjs"

test("document objects are create-only and verify new or existing bytes", async () => {
  for (const status of [200, 412]) {
    const bytes = new TextEncoder().encode("synthetic-original")
    const calls = []
    await registerDocumentObject(
      "synthetic-bucket",
      "synthetic-object",
      bytes,
      "synthetic-token",
      async (url, options) => {
        calls.push({ url, options })
        return calls.length === 1
          ? new Response(null, { status })
          : new Response(bytes)
      },
    )
    assert.match(calls[0].url, /ifGenerationMatch=0/)
    assert.equal(calls.length, 2)
  }
})
test("corruption or missing objects never establish registration", async () => {
  for (const response of [
    new Response("changed"),
    new Response(null, { status: 404 }),
  ]) {
    let calls = 0
    await assert.rejects(
      registerDocumentObject(
        "synthetic-bucket",
        "synthetic-object",
        new Uint8Array([1]),
        "synthetic-token",
        async () =>
          ++calls === 1 ? new Response(null, { status: 412 }) : response,
      ),
    )
  }
})
test("distribution requires registration of the exact image, project and set", () => {
  const image = {
    imageId: `sha256:${"a".repeat(64)}`,
    documentSet: { version: "1.0", sha256: "b".repeat(64) },
  }
  const receipt = {
    version: 1,
    project: "synthetic-project",
    bucket: documentBucket("synthetic-project"),
    ...image,
  }
  assertDocumentRegistration(receipt, image, receipt.project)
  assert.throws(() =>
    assertDocumentRegistration(undefined, image, receipt.project),
  )
  assert.throws(() =>
    assertDocumentRegistration(
      receipt,
      { ...image, imageId: "different" },
      receipt.project,
    ),
  )
  assert.throws(() =>
    assertDocumentRegistration(
      receipt,
      {
        ...image,
        documentSet: { ...image.documentSet, sha256: "c".repeat(64) },
      },
      receipt.project,
    ),
  )
})
