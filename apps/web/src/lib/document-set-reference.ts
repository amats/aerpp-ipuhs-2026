import { DocumentSetReferenceSchema } from "@aerpp/participant-api-contracts/participant-api"

// Next.js replaces this build-only marker in both the rendered UI and server.
// It describes the compiled document set, never a runtime operator alias.
export function readDisplayedDocumentSet() {
  return DocumentSetReferenceSchema.parse(
    JSON.parse(process.env.AERPP_WEB_DOCUMENT_SET ?? "null"),
  )
}
