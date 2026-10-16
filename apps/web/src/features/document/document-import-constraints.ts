import { DOCUMENT_CONSTRAINTS } from "./document-constraints"

// Office containers may be large because of media that text extraction skips.
// Only selected XML is read/expanded; draft text keeps the editing allowance
// above the 30,000-grapheme analysis budget.
export const DOCUMENT_IMPORT_CONSTRAINTS = {
  maxTextFileBytes: 1_000_000,
  maxReadBytes: 128 * 1024 * 1024,
  maxDirectoryBytes: 8 * 1024 * 1024,
  maxArchiveEntries: 10000,
  maxCompressedXmlBytes: 16 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxXmlBytes: 8 * 1024 * 1024,
  maxXmlDepth: 64,
  maxXmlNodes: 300000,
  maxSlides: 1000,
  maxTextCodeUnits: DOCUMENT_CONSTRAINTS.maxDocumentCodeUnits,
  timeoutMs: 60000,
} as const
