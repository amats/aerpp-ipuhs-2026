import {
  createDocumentSet,
  DOCUMENT_FILES,
  type DocumentName,
  documentObjectName,
} from "@aerpp/config/document-set"
import { expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: { environment: "example" },
}))
vi.mock("@/lib/google-auth", () => ({ googleClientOptions: {} }))

import { loadDocumentOriginal, verifyDocumentArchive } from "./document-archive"

const files = Object.fromEntries(
  DOCUMENT_FILES.map((name) => [
    name,
    new TextEncoder().encode(`synthetic ${name}`),
  ]),
) as Record<DocumentName, Uint8Array>

const artifact = createDocumentSet("1.0", files)
const objects = new Map([
  [
    documentObjectName(artifact.reference.sha256),
    new TextEncoder().encode(artifact.json),
  ],
  ...DOCUMENT_FILES.map(
    (name) =>
      [
        documentObjectName(artifact.reference.sha256, name),
        files[name],
      ] as const,
  ),
])
function storedObject(name: string) {
  const bytes = objects.get(name)
  if (bytes === undefined) throw new Error("Missing synthetic original")
  return bytes
}
it("retrieves the recorded original and verifies every set member", async () => {
  const read = vi.fn(async (name: string) => storedObject(name))
  expect(
    await loadDocumentOriginal(artifact.reference, "consent.pdf", read),
  ).toEqual(files["consent.pdf"])
  await verifyDocumentArchive(artifact.reference, read)
  expect(new Set(read.mock.calls.map(([name]) => name)).size).toBe(9)
})
it("rejects corrupt members and version relabelling without current-source fallback", async () => {
  const corrupt = async (name: string) =>
    name.endsWith("plan.pdf") ? new Uint8Array([0]) : storedObject(name)
  await expect(
    verifyDocumentArchive(artifact.reference, corrupt),
  ).rejects.toThrow("integrity")
  await expect(
    loadDocumentOriginal(
      { ...artifact.reference, version: "2.0" },
      "consent.pdf",
      async (name) => storedObject(name),
    ),
  ).rejects.toThrow("integrity")
})
it("rejects a local profile rather than falling back to cloud credentials", async () => {
  await expect(
    loadDocumentOriginal(artifact.reference, "consent.pdf"),
  ).rejects.toThrow("Explicit document archive environment")
})
