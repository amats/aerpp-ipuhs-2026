export type DocumentDraft = {
  documents: Record<string, string>
  documentNames: Record<string, string>
  activeDocumentKey: string
  // Names of files read locally; no File objects or server uploads are retained.
  sourceFileNames: Record<string, string>
  restoredAnalysisJobId: string | null
}

export type UpdateDocumentDraft = (
  update: (current: DocumentDraft) => DocumentDraft,
) => void

export const EMPTY_DOCUMENT_DRAFT: DocumentDraft = {
  documents: { "document-1": "" },
  documentNames: { "document-1": "書類1" },
  activeDocumentKey: "document-1",
  sourceFileNames: {},
  restoredAnalysisJobId: null,
}
