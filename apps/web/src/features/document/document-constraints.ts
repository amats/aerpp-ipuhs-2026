export const DOCUMENT_CONSTRAINTS = {
  docxMimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docxExtensions: [".docx"] as string[],
  pptxMimeType:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptxExtensions: [".pptx"] as string[],
  textExtensions: [".txt", ".md"] as string[],
  maxTotalGraphemes: 30000,
  maxDocuments: 20,
  maxDocumentNameCodeUnits: 200,
  maxDocumentCodeUnits: 128000,
  maxTotalCodeUnits: 256000,
  maxRequestBytes: 1100000,
} as const

export const DOCUMENT_ACCEPT_TYPES = [
  DOCUMENT_CONSTRAINTS.docxMimeType,
  DOCUMENT_CONSTRAINTS.pptxMimeType,
  "text/plain",
  "text/markdown",
  ...DOCUMENT_CONSTRAINTS.docxExtensions,
  ...DOCUMENT_CONSTRAINTS.pptxExtensions,
  ...DOCUMENT_CONSTRAINTS.textExtensions,
].join(",")
