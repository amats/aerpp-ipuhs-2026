import type { DocumentSetReference } from "@aerpp/config/document-set"
import { renderDocumentPdf } from "@aerpp/documents/pdf"

export async function fillParticipantPdf(
  templateBytes: Uint8Array,
  fontBytes: Uint8Array,
  values: {
    email: string
    date: string
    documentId: string
    documentSet: DocumentSetReference
  },
): Promise<Uint8Array> {
  return renderDocumentPdf(templateBytes, fontBytes, values.documentSet, values)
}
