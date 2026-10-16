import { describe, expect, it } from "vitest"
import { DOCUMENT_CONSTRAINTS } from "./document-constraints"
import {
  countDocumentBodyGraphemes,
  getDocumentReadiness,
  restoreDocumentDraft,
} from "./document-draft"
import { EMPTY_DOCUMENT_DRAFT } from "./document-draft-types"

function readiness(
  documents: Record<string, string>,
  names: Record<string, string>,
) {
  return getDocumentReadiness(
    documents,
    names,
    countDocumentBodyGraphemes(documents),
  )
}

describe("document readiness", () => {
  it("counts graphemes and includes names only for documents with a body", () => {
    const documents = { filled: "👩‍💻e\u0301", blank: " \n" }
    expect(countDocumentBodyGraphemes(documents)).toEqual({
      filled: 2,
      blank: 2,
    })
    expect(
      readiness(documents, { filled: "申請書", blank: "未使用の書類名" }),
    ).toEqual({ totalGraphemeCount: 7, analysisDisabledReason: null })
  })

  it("requires a nonblank body before checking names or limits", () => {
    expect(readiness({ first: " " }, {}).analysisDisabledReason).toBe(
      "本文を入力するか、ファイルを読み込んでください。",
    )
    expect(
      readiness({ first: "本文" }, { first: " \n" }).analysisDisabledReason,
    ).toBe("本文のある書類に書類名を入力してください。")
    expect(
      readiness({ first: "x".repeat(30_001) }, {}).analysisDisabledReason,
    ).toBe("本文のある書類に書類名を入力してください。")
  })

  it("allows the exact total limit and rejects one additional grapheme", () => {
    const documents = {
      first: "x".repeat(DOCUMENT_CONSTRAINTS.maxTotalGraphemes - 1),
    }
    expect(
      readiness(documents, { first: "名" }).analysisDisabledReason,
    ).toBeNull()
    expect(readiness(documents, { first: "名前" }).analysisDisabledReason).toBe(
      "書類名と本文の合計が上限を1字超えています。内容を短くしてください。",
    )
  })

  it("counts empty tabs toward the document limit", () => {
    const documents = Object.fromEntries(
      Array.from({ length: DOCUMENT_CONSTRAINTS.maxDocuments }, (_, index) => [
        `document-${index}`,
        index === 0 ? "本文" : "",
      ]),
    )
    const names = { "document-0": "書類" }
    expect(readiness(documents, names).analysisDisabledReason).toBeNull()
    expect(
      readiness({ ...documents, extra: "" }, names).analysisDisabledReason,
    ).toBe(`書類を${DOCUMENT_CONSTRAINTS.maxDocuments}件以下にしてください。`)
  })
})

describe("analysis job draft restoration", () => {
  it("selects the first filled document and preserves supplied names", () => {
    const job = {
      jobId: "job-1",
      documents: { empty: " ", filled: "本文", later: "別紙" },
      documentNames: { empty: "", filled: "申請書" },
    }
    const draft = restoreDocumentDraft(job)
    expect(draft).toEqual({
      documents: job.documents,
      documentNames: { empty: "", filled: "申請書", later: "書類3" },
      sourceFileNames: {},
      activeDocumentKey: "filled",
      restoredAnalysisJobId: "job-1",
    })
    draft.documents.filled = "編集後"
    draft.documentNames.filled = "変更後"
    expect(job.documents.filled).toBe("本文")
    expect(job.documentNames.filled).toBe("申請書")
  })

  it("falls back to the first tab when all documents are blank", () => {
    expect(
      restoreDocumentDraft({ jobId: "job-2", documents: { blank: " " } }),
    ).toMatchObject({
      activeDocumentKey: "blank",
      documentNames: { blank: "書類1" },
    })
  })

  it("creates an editable empty draft without changing the shared default", () => {
    const draft = restoreDocumentDraft({ jobId: "job-3", documents: {} })
    expect(draft).toEqual({
      ...EMPTY_DOCUMENT_DRAFT,
      restoredAnalysisJobId: "job-3",
    })
    draft.documents["document-1"] = "編集後"
    expect(EMPTY_DOCUMENT_DRAFT.documents["document-1"]).toBe("")
  })
})
