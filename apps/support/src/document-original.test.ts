import {
  createDocumentSet,
  DOCUMENT_FILES,
  documentObjectName,
} from "@aerpp/config/document-set"
import { expect, it } from "vitest"
import { createEmailConfirmationFixture } from "../test-support/email-confirmation.js"
import { readDocumentOriginal } from "./document-original.js"

function fixture() {
  const { db, run, runtime } = createEmailConfirmationFixture()
  const files = Object.fromEntries(
    DOCUMENT_FILES.map((name) => [
      name,
      new TextEncoder().encode(`synthetic-${name}`),
    ]),
  ) as Parameters<typeof createDocumentSet>[1]
  const artifact = createDocumentSet("1.0", files)
  db.seed("participationEvents/consent-1", {
    eventType: "consent",
    pseudonym: "person-1",
    documentSet: artifact.reference,
  })
  const read = async (name: string) =>
    name === documentObjectName(artifact.reference.sha256)
      ? new TextEncoder().encode(artifact.json)
      : files[name.split("/").at(-1) as keyof typeof files]
  return { db, run, runtime, artifact, read }
}
it("retrieves a verified original from its event after withdrawal without changing participation", async () => {
  const { db, run, runtime, artifact, read } = fixture()
  db.seed("participationStates/retained", { status: "withdrawn" })
  const before = [...db.records]
  const result = await run(() =>
    readDocumentOriginal(
      { pseudonym: "person-1", recordId: "consent-1", name: "consent.pdf" },
      runtime,
      read,
    ),
  )
  expect(result.documentSet).toEqual(artifact.reference)
  expect(Buffer.from(result.contentBase64, "base64").toString()).toBe(
    "synthetic-consent.pdf",
  )
  expect([...db.records]).toEqual(before)
})
it.each([
  { pseudonym: "other-person", recordId: "consent-1", name: "consent.pdf" },
  { pseudonym: "person-1", recordId: "missing", name: "consent.pdf" },
  { pseudonym: "person-1", recordId: "consent-1", name: "withdrawal.pdf" },
  { pseudonym: "person-1", recordId: "consent-1", name: "../secret" },
])("rejects a foreign, missing or mismatched original %j", async (request) => {
  const { run, runtime, read } = fixture()
  await expect(
    run(() => readDocumentOriginal(request, runtime, read)),
  ).rejects.toBeDefined()
})
it("does not fall back to current originals or cloud credentials in local execution", async () => {
  const { run, runtime, read } = fixture()
  const request = {
    pseudonym: "person-1",
    recordId: "consent-1",
    name: "consent.pdf",
  }
  await expect(
    run(() => readDocumentOriginal(request, runtime)),
  ).rejects.toMatchObject({ code: "DOCUMENT_ARCHIVE_UNAVAILABLE" })
  await expect(
    run(() =>
      readDocumentOriginal(request, runtime, async (name) =>
        name.endsWith("consent.pdf") ? new Uint8Array([1]) : read(name),
      ),
    ),
  ).rejects.toThrow("integrity")
})
