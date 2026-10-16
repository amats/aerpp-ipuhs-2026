import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { PDF, rgb, StandardFonts } from "@libpdf/core"

export function readDocumentFont(
  workspaceDirectory: string,
): Promise<Uint8Array> {
  // Explicit server filesystem access avoids bundlers emitting a second,
  // browser-facing copy of this PDF-only font.
  return readFile(
    resolve(
      workspaceDirectory,
      "packages/documents/fonts/NotoSansJP-Regular.ttf",
    ),
  )
}
export async function renderDocumentPdf(
  templateBytes: Uint8Array,
  fontBytes: Uint8Array,
  documentSet: { version: string; sha256: string },
  participant?: { email: string; date: string; documentId: string },
): Promise<Uint8Array> {
  if (
    /^[a-f0-9]{64}$/.test(documentSet.sha256) !== true ||
    /^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(documentSet.version) !== true
  )
    throw new Error("Invalid PDF document set")
  const pdfDoc = await PDF.load(templateBytes)
  const font = pdfDoc.embedFont(fontBytes)
  if (participant !== undefined) {
    const form = pdfDoc.getForm()
    if (!form) throw new Error("Missing participant PDF form")
    // Neither a legacy field nor its presence is required by this renderer.
    form.removeField("did")
    for (const [name, value] of Object.entries({
      email: participant.email,
      date: participant.date,
    })) {
      const field = form.getTextField(name)
      if (!field) throw new Error(`Missing participant PDF text field: ${name}`)
      field.setFont(font)
      field.setValue(value)
    }
    form.flatten()
    if (form.getFields().length !== 0)
      throw new Error("Participant PDF form was not fully flattened")
  }
  const page = pdfDoc.getPages().at(-1)
  if (page === undefined) throw new Error("Missing participant PDF page")
  const color = rgb(0.32, 0.32, 0.32)
  page.drawLine({
    start: { x: 92, y: 121 },
    end: { x: 510, y: 121 },
    color: rgb(0.76, 0.76, 0.76),
    thickness: 0.45,
  })
  page.drawText(`文書セット v${documentSet.version}`, {
    x: 92,
    y: 106,
    size: 8,
    font,
    color,
  })
  if (participant !== undefined) {
    page.drawText(`DID  ${participant.documentId}`, {
      x: 92,
      y: 89,
      size: 9,
      font: StandardFonts.Courier,
      color,
    })
    page.drawText(`SHA-256  ${documentSet.sha256}`, {
      x: 92,
      y: 73,
      size: 8,
      font: StandardFonts.Courier,
      color,
    })
  }
  return pdfDoc.save()
}
