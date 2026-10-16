import type { AnalysisJob } from "@/features/app-context/app-context-types"
import { countGraphemes } from "@/lib/graphemes"
import { DOCUMENT_CONSTRAINTS } from "./document-constraints"
import {
  type DocumentDraft,
  EMPTY_DOCUMENT_DRAFT,
} from "./document-draft-types"

export function countDocumentBodyGraphemes(documents: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(documents).map(([key, text]) => [key, countGraphemes(text)]),
  )
}

export function getDocumentReadiness(
  documents: Record<string, string>,
  documentNames: Record<string, string>,
  bodyGraphemeCounts: Record<string, number>,
) {
  const totalGraphemeCount = Object.entries(bodyGraphemeCounts).reduce(
    (sum, [key, count]) =>
      sum +
      count +
      (documents[key].trim() !== ""
        ? countGraphemes(documentNames[key] ?? "")
        : 0),
    0,
  )
  const maxTotalGraphemes = DOCUMENT_CONSTRAINTS.maxTotalGraphemes
  let analysisDisabledReason: string | null = null
  if (Object.values(documents).some((text) => text.trim() !== "") !== true) {
    analysisDisabledReason = "本文を入力するか、ファイルを読み込んでください。"
  } else if (
    Object.entries(documents).some(
      ([key, text]) =>
        text.trim() !== "" && (documentNames[key]?.trim() ?? "") === "",
    ) === true
  ) {
    analysisDisabledReason = "本文のある書類に書類名を入力してください。"
  } else if (totalGraphemeCount > maxTotalGraphemes) {
    analysisDisabledReason = `書類名と本文の合計が上限を${(totalGraphemeCount - maxTotalGraphemes).toLocaleString()}字超えています。内容を短くしてください。`
  } else if (
    Object.keys(documents).length > DOCUMENT_CONSTRAINTS.maxDocuments
  ) {
    analysisDisabledReason = `書類を${DOCUMENT_CONSTRAINTS.maxDocuments}件以下にしてください。`
  }
  return { totalGraphemeCount, analysisDisabledReason }
}

export function restoreDocumentDraft(analysisJob: AnalysisJob): DocumentDraft {
  const restoredDocuments =
    Object.keys(analysisJob.documents).length > 0
      ? { ...analysisJob.documents }
      : { ...EMPTY_DOCUMENT_DRAFT.documents }
  const restoredDocumentKeys = Object.keys(restoredDocuments)
  const firstFilledDocumentKey = restoredDocumentKeys.find((key) => {
    const document = restoredDocuments[key]
    return typeof document === "string" && document.trim() !== ""
  })

  return {
    documents: restoredDocuments,
    documentNames: Object.fromEntries(
      restoredDocumentKeys.map((key, index) => [
        key,
        analysisJob.documentNames?.[key] ?? `書類${index + 1}`,
      ]),
    ),
    sourceFileNames: {},
    activeDocumentKey:
      firstFilledDocumentKey ?? restoredDocumentKeys[0] ?? "document-1",
    restoredAnalysisJobId: analysisJob.jobId,
  }
}
