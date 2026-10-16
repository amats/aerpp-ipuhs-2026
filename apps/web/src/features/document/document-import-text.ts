import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"

export function normalizeExtractedText(input: string) {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim()
}

export function checkExtractedText(text: string) {
  if (text.length > limits.maxTextCodeUnits) throw new Error("Text too large")
  return normalizeExtractedText(text)
}
