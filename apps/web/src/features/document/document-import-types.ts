export type OfficeDocumentKind = "docx" | "pptx"

export type DocumentImportRequest = {
  kind: OfficeDocumentKind
  file: File
}

export type DocumentImportResponse = { ok: true; text: string } | { ok: false }
