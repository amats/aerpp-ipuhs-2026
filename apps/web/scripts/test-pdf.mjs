import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readDocumentFont } from "@aerpp/documents/pdf"
import { PDFDocument } from "pdf-lib"
import { fillParticipantPdf } from "../src/features/pdf/fill-participant-pdf.ts"
import { researchAssetsDirectory } from "../src/lib/research-assets.mjs"

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url))
const TEST_DOCUMENTS = [
  { type: "consent", documentId: `aerpp:did-${"d".repeat(32)}` },
  { type: "withdrawal", documentId: `aerpp:did-${"e".repeat(32)}` },
]
const TEST_EMAIL = "pdf-test@example.com"
const TEST_DATE = "2026年9月16日"

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export async function testPdfs(webDirectory = WEB_ROOT) {
  const assetsDirectory = researchAssetsDirectory(webDirectory)
  const fontBytes = await readDocumentFont(path.resolve(WEB_ROOT, "../.."))
  const documents = []
  // Finish both selected templates before saving a run; never mix asset sets.
  for (const { type, documentId } of TEST_DOCUMENTS) {
    const templateBytes = await readFile(
      path.join(assetsDirectory, `${type}.pdf`),
    )
    const template = await PDFDocument.load(templateBytes)
    const values = {
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      email: TEST_EMAIL,
      date: TEST_DATE,
      documentId,
    }
    const pdfBytes = await fillParticipantPdf(templateBytes, fontBytes, values)
    const saved = await PDFDocument.load(pdfBytes)
    if (
      saved.getPageCount() !== template.getPageCount() ||
      saved.getPageCount() === 0 ||
      saved.getForm().getFields().length !== 0
    ) {
      throw new Error(`PDF verification failed: ${type}`)
    }
    documents.push({
      pdfBytes,
      filename: `AERPP-${type}-TEST.pdf`,
      values,
      templateSha256: sha256(templateBytes),
      outputSha256: sha256(pdfBytes),
      pageCount: saved.getPageCount(),
    })
  }

  const outputRoot = path.join(webDirectory, "generated/pdf")
  await mkdir(outputRoot, { recursive: true })
  const outputDirectory = await mkdtemp(path.join(outputRoot, "run-"))
  for (const { filename, pdfBytes } of documents) {
    await writeFile(path.join(outputDirectory, filename), pdfBytes, {
      flag: "wx",
    })
  }
  await writeFile(
    path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        synthetic: true,
        createdAt: new Date().toISOString(),
        fontSha256: sha256(fontBytes),
        documents: documents.map(({ pdfBytes: _pdfBytes, ...entry }) => entry),
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  )
  return outputDirectory
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: pnpm --filter @aerpp/web run test:pdf\nFill selected consent/withdrawal PDF forms and draw the DID footer with synthetic values.\nOutput: generated/pdf/run-*/ (PDFs and manifest.json).\nRequires Node 24, assets/{consent,withdrawal}.pdf (assets-public/ on a fresh clone) with email/date fields and the bundled font.\nNo environment files, network services, or browser are used.",
    )
  } else if (args.length > 0) {
    console.error(
      "Unsupported arguments. Run pnpm --filter @aerpp/web run test:pdf --help",
    )
    process.exitCode = 1
  } else {
    try {
      const outputDirectory = await testPdfs()
      console.log(
        `PDF form test passed. Synthetic PDFs saved to: ${outputDirectory}`,
      )
    } catch (error) {
      console.error("PDF form test failed:", error.message)
      process.exitCode = 1
    }
  }
}
