import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PDF } from "@libpdf/core"
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from "pdf-lib"
import { afterEach, expect, it } from "vitest"
import { spawnCaptured } from "../test-support/spawn-captured.mjs"
import { testPdfs } from "./test-pdf.mjs"

const directories: string[] = []
const repoRoot = fileURLToPath(new URL("../", import.meta.url))

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture(missingField = false, pageCount = 1) {
  const root = await mkdtemp(path.join(tmpdir(), "aerpp-pdf-test-"))
  directories.push(root)
  await mkdir(path.join(root, "assets"), { recursive: true })
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  for (const [index, name] of ["email", "date"].entries()) {
    if (missingField && name === "date") continue
    doc
      .getForm()
      .createTextField(name)
      .addToPage(page, {
        x: 20,
        y: 100 + index * 50,
        width: 450,
        height: 30,
      })
  }
  for (let index = 1; index < pageCount; index++) doc.addPage()
  const bytes = await doc.save()
  for (const type of ["consent", "withdrawal"]) {
    await writeFile(path.join(root, `assets/${type}.pdf`), bytes)
  }
  return { root, bytes }
}

it("fills forms without a DID field, preserves sources, and saves separate verified runs", async () => {
  const { root, bytes } = await fixture()
  const output = await testPdfs(root)
  const manifest = JSON.parse(
    await readFile(path.join(output, "manifest.json"), "utf8"),
  )
  expect(manifest.synthetic).toBe(true)
  expect(manifest.documents).toHaveLength(2)
  expect(manifest.documents[0].values.documentId).not.toBe(
    manifest.documents[1].values.documentId,
  )
  for (const [index, type] of ["consent", "withdrawal"].entries()) {
    const entry = manifest.documents[index]
    const savedBytes = await readFile(path.join(output, entry.filename))
    const saved = await PDFDocument.load(savedBytes)
    expect(saved.getPageCount()).toBe(1)
    expect(saved.getForm().getFields()).toHaveLength(0)
    expect(savedBytes.length).toBeGreaterThan(bytes.length)
    // The Japanese font is embedded once and shared by the email/date fields.
    const fontDescriptors = saved.context
      .enumerateIndirectObjects()
      .filter(
        ([, object]) =>
          object instanceof PDFDict &&
          object.get(PDFName.of("Type")) === PDFName.of("FontDescriptor") &&
          object.has(PDFName.of("FontFile2")),
      )
    expect(fontDescriptors).toHaveLength(1)
    const unicodeMaps = saved.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) => {
        if (
          !(object instanceof PDFDict) ||
          !object.has(PDFName.of("ToUnicode"))
        )
          return []
        const stream = object.lookup(PDFName.of("ToUnicode"))
        if (!(stream instanceof PDFRawStream))
          throw new Error("Expected a ToUnicode stream")
        return [new TextDecoder().decode(decodePDFRawStream(stream).decode())]
      })
      .join("\n")
    // Full-font embedding must retain the actual Unicode values for copy/search.
    for (const hex of ["5e74", "6708", "65e5"])
      expect(unicodeMaps.toLowerCase()).toContain(`> <${hex}>`)
    expect(entry.outputSha256).toBe(
      createHash("sha256").update(savedBytes).digest("hex"),
    )
    expect(entry.templateSha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    )
    expect(entry.values.email).toBe("pdf-test@example.com")
    expect(entry.values.date).toBe("2026年9月16日")
    expect(entry.values.documentId).toMatch(/^aerpp:did-[A-Za-z0-9]{32}$/)
    const printed = await PDF.load(savedBytes)
    expect(printed.extractText()[0].text).toContain(entry.values.documentId)
    expect(await readFile(path.join(root, `assets/${type}.pdf`))).toEqual(
      Buffer.from(bytes),
    )
  }
  expect(await testPdfs(root)).not.toBe(output)
}, 30_000)

it("prints the DID only on the final page of a multi-page template", async () => {
  const { root } = await fixture(false, 2)
  const output = await testPdfs(root)
  const printed = await PDF.load(
    await readFile(path.join(output, "AERPP-consent-TEST.pdf")),
  )
  const pages = printed.extractText()
  expect(pages).toHaveLength(2)
  expect(pages[0].text).not.toContain("aerpp:did-")
  expect(pages[1].text).toContain(`aerpp:did-${"d".repeat(32)}`)
})

it("fails without a required form field and does not write a successful run", async () => {
  const { root } = await fixture(true)
  await expect(testPdfs(root)).rejects.toThrow(/date/)
  await expect(stat(path.join(root, "generated/pdf"))).rejects.toMatchObject({
    code: "ENOENT",
  })
})

it("fails for a missing required PDF", async () => {
  const { root } = await fixture()
  await rm(path.join(root, "assets/consent.pdf"))
  await expect(testPdfs(root)).rejects.toThrow(/ENOENT/)
})

it("supports CLI help from another directory and rejects unsupported arguments", () => {
  const script = path.join(repoRoot, "scripts/test-pdf.mjs")
  const help = spawnCaptured(process.execPath, [script, "--help"], {
    cwd: tmpdir(),
  })
  expect(help.status).toBe(0)
  expect(help.stdout).toContain("pnpm --filter @aerpp/web run test:pdf")
  const invalid = spawnCaptured(process.execPath, [script, "--unknown"], {
    cwd: tmpdir(),
  })
  expect(invalid.status).toBe(1)
  expect(invalid.stderr).toContain("Unsupported arguments")
})
