import {
  extractDocxContent,
  extractPptxContent,
} from "./document-extraction-core"
import type {
  DocumentImportRequest,
  DocumentImportResponse,
} from "./document-import-types"

// This module is instantiated only by the browser's dedicated Worker bridge.
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<DocumentImportRequest>) => void
  postMessage: (message: DocumentImportResponse) => void
}
worker.onmessage = async ({ data }) => {
  try {
    const text =
      data.kind === "docx"
        ? await extractDocxContent(data.file)
        : await extractPptxContent(data.file)
    worker.postMessage({ ok: true, text })
  } catch {
    // Neither parser exceptions nor document content cross the UI boundary.
    worker.postMessage({ ok: false })
  }
}
