import { DOCUMENT_CONSTRAINTS } from "./document-constraints"
import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"
import type {
  DocumentImportResponse,
  OfficeDocumentKind,
} from "./document-import-types"

export { normalizeExtractedText } from "./document-import-text"

export function isPlainTextFile(file: File, lowerCaseName: string) {
  if (file.type.startsWith("text/")) {
    return true
  }
  const extensionStart = lowerCaseName.lastIndexOf(".")
  if (extensionStart === -1) {
    return false
  }
  const extension = lowerCaseName.slice(extensionStart)
  if (DOCUMENT_CONSTRAINTS.textExtensions.includes(extension)) {
    return true
  }
  return false
}

export function isDocxFile(file: File, lowerCaseName: string) {
  return (
    file.type === DOCUMENT_CONSTRAINTS.docxMimeType ||
    lowerCaseName.endsWith(".docx")
  )
}

export function isPptxFile(file: File, lowerCaseName: string) {
  return (
    file.type === DOCUMENT_CONSTRAINTS.pptxMimeType ||
    lowerCaseName.endsWith(".pptx")
  )
}

export function validateImportFile(file: File) {
  const name = file.name.toLowerCase()
  if (
    isDocxFile(file, name) !== true &&
    isPptxFile(file, name) !== true &&
    file.size > limits.maxTextFileBytes
  )
    throw new Error("File too large")
}

function extractOfficeFile(
  file: File,
  kind: OfficeDocumentKind,
  signal?: AbortSignal,
) {
  validateImportFile(file)
  return new Promise<string>((resolve, reject) => {
    let worker: Worker | undefined
    let settled = false
    const finish = (text?: string) => {
      if (settled === true) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      worker?.terminate()
      if (text === undefined)
        reject(new Error("Document import failed or cancelled"))
      else resolve(text)
    }
    const abort = () => finish()
    const timer = setTimeout(abort, limits.timeoutMs)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted === true) {
      abort()
      return
    }
    try {
      worker = new Worker(
        new URL("./document-extraction.worker.ts", import.meta.url),
        { type: "module" },
      )
      worker.onmessage = ({ data }: MessageEvent<DocumentImportResponse>) => {
        if (
          data?.ok === true &&
          typeof data.text === "string" &&
          data.text.length <= limits.maxTextCodeUnits
        )
          finish(data.text)
        else finish()
      }
      worker.onerror = (event) => {
        event.preventDefault()
        finish()
      }
      worker.onmessageerror = () => finish()
      // Structured-clone the File handle. The Worker reads bounded slices;
      // never copy the entire media-bearing container into an ArrayBuffer.
      worker.postMessage({ kind, file })
    } catch {
      finish()
    }
  })
}

export function extractDocxText(file: File, signal?: AbortSignal) {
  return extractOfficeFile(file, "docx", signal)
}

export function extractPptxText(file: File, signal?: AbortSignal) {
  return extractOfficeFile(file, "pptx", signal)
}
