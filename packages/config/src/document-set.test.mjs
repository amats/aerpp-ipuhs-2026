import assert from "node:assert/strict"
import test from "node:test"
import {
  createDocumentSet,
  DOCUMENT_FILES,
  documentObjectName,
  verifyDocumentFile,
  verifyDocumentSet,
} from "./document-set.mjs"

const files = Object.fromEntries(
  DOCUMENT_FILES.map((name) => [
    name,
    new TextEncoder().encode(`synthetic-${name}`),
  ]),
)
test("document identity binds exact originals and human version, independently of input key order", () => {
  const first = createDocumentSet("1.0", files)
  const reordered = createDocumentSet(
    "1.0",
    Object.fromEntries(Object.entries(files).reverse()),
  )
  assert.deepEqual(first, reordered)
  assert.deepEqual(
    verifyDocumentSet(first.json, first.reference),
    first.manifest,
  )
  assert.notEqual(
    createDocumentSet("1.1", files).reference.sha256,
    first.reference.sha256,
  )
  assert.notEqual(
    createDocumentSet("1.0", {
      ...files,
      "consent.mdx": new TextEncoder().encode("changed"),
    }).reference.sha256,
    first.reference.sha256,
  )
})
test("missing, corrupt, noncanonical or relabelled originals cannot be substituted", () => {
  const artifact = createDocumentSet("1.0", files)
  assert.throws(() =>
    verifyDocumentSet(`${artifact.json}\n`, artifact.reference),
  )
  assert.throws(() =>
    verifyDocumentSet(artifact.json, { ...artifact.reference, version: "2.0" }),
  )
  assert.throws(() => createDocumentSet("1.0", {}))
  assert.throws(() =>
    verifyDocumentFile(artifact.manifest, "consent.pdf", files["plan.pdf"]),
  )
  assert.equal(
    verifyDocumentFile(artifact.manifest, "consent.pdf", files["consent.pdf"]),
    files["consent.pdf"],
  )
  assert.throws(() =>
    documentObjectName(artifact.reference.sha256, "../secret"),
  )
  assert.throws(() => documentObjectName("invalid"))
})
