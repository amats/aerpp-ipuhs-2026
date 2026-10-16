import "server-only"
import { renderDocumentPdf } from "@aerpp/documents/pdf"
import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import { readPdfFont, readPdfTemplate } from "./pdf-templates"

async function readDocumentPdf(name: "explanation" | "plan") {
  const [template, font] = await Promise.all([
    readPdfTemplate(name),
    readPdfFont(),
  ])
  return renderDocumentPdf(template, font, readDisplayedDocumentSet())
}
export function readExplanationPdf() {
  return readDocumentPdf("explanation")
}
export function readPlanPdf() {
  return readDocumentPdf("plan")
}
