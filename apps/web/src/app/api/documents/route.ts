import { handleDocumentRead } from "@/features/pdf/document-route"

export async function GET(request: Request) {
  return handleDocumentRead(request)
}
