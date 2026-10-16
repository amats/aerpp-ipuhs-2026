/** @vitest-environment jsdom */

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"
import { DOCUMENT_CONSTRAINTS } from "./document-constraints"
import { EMPTY_DOCUMENT_DRAFT } from "./document-draft-types"

const analysisJobMock = {
  current: null as {
    jobId: string
    documents: Record<string, string>
  } | null,
}
const updateStatusMock = vi.fn()
const resetToStartMock = vi.fn()
const startAnalysisMock = vi.fn<
  (job: { jobId: string; documents: Record<string, string> }) => Promise<
    | {
        ok: true
      }
    | {
        ok: false
        reason: "step_state_write_failed"
      }
  >
>(async () => ({
  ok: true,
}))
const extractDocxTextMock = vi.fn()
const extractPptxTextMock = vi.fn()

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => {
    const [documentDraft, updateDocumentDraft] = useState(EMPTY_DOCUMENT_DRAFT)
    return {
      analysisJob: analysisJobMock.current,
      resetToStart: resetToStartMock,
      startAnalysis: startAnalysisMock,
      stage: Stage.authenticated,
      documentDraft,
      updateDocumentDraft,
    }
  },
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    updateStatusMessage: updateStatusMock,
  }),
}))

vi.mock("./document-file-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./document-file-extraction")>()),
  extractDocxText: extractDocxTextMock,
  extractPptxText: extractPptxTextMock,
}))

function selectFile(
  container: HTMLElement,
  extension: string,
  key = "document-1",
) {
  const input = container.querySelector<HTMLInputElement>(
    `#doc-panel-${key} input[type="file"]`,
  )
  if (!input) throw new Error(`Missing file input for ${key}`)
  const file = new File([""], `${key}.${extension}`)
  vi.spyOn(file, "text").mockResolvedValue(`uploaded-${key}`)
  Object.defineProperty(input, "files", { configurable: true, value: [file] })
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function changeInputValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  Object.getOwnPropertyDescriptor(
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    "value",
  )?.set?.call(control, value)
  control.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("SectionDocument", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.scrollTo = vi.fn()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    analysisJobMock.current = null
    resetToStartMock.mockReset()
    updateStatusMock.mockReset()
    startAnalysisMock.mockReset()
    startAnalysisMock.mockResolvedValue({
      ok: true,
    })

    extractDocxTextMock.mockReset()
    extractPptxTextMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it.each([false, true])(
    "locks controls during analysis start and allows retry after failure (transport=%s)",
    async (transportFailure) => {
      let finish!: () => void
      startAnalysisMock.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = () =>
              transportFailure
                ? reject(new Error("network unavailable"))
                : resolve({ ok: false, reason: "step_state_write_failed" })
          }),
      )
      const { default: SectionDocument } = await import("./section-document")
      const root = createRoot(container)
      try {
        await act(async () => root.render(<SectionDocument />))
        const editor = container.querySelector(
          "textarea",
        ) as HTMLTextAreaElement
        const name = container.querySelector(
          'input[type="text"]',
        ) as HTMLInputElement
        await act(async () => {
          changeInputValue(editor, "Retained body")
          changeInputValue(name, "Retained name")
        })
        const button = Array.from(container.querySelectorAll("button")).find(
          (item) => item.textContent === "解析を開始する",
        ) as HTMLButtonElement
        await act(async () => button.click())
        expect(button.disabled).toBe(true)
        expect(button.textContent).toBe("開始しています...")
        expect(editor.matches(":disabled")).toBe(true)
        expect(name.matches(":disabled")).toBe(true)
        expect(container.textContent).toContain(
          "解析を開始しています。しばらくお待ちください。",
        )
        await act(async () => button.click())
        expect(startAnalysisMock).toHaveBeenCalledTimes(1)
        await act(async () => finish())
        expect(button.disabled).toBe(false)
        expect(editor.matches(":disabled")).toBe(false)
        expect(name.matches(":disabled")).toBe(false)
        expect(editor.value).toBe("Retained body")
        expect(name.value).toBe("Retained name")
        expect(updateStatusMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ tone: "error" }),
        )
        await act(async () => button.click())
        expect(startAnalysisMock).toHaveBeenCalledTimes(2)
        expect(startAnalysisMock).toHaveBeenLastCalledWith(
          expect.objectContaining({
            documents: { "document-1": "Retained body" },
            documentNames: { "document-1": "Retained name" },
          }),
        )
        expect(updateStatusMock).toHaveBeenLastCalledWith(null)
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it("keeps the empty editor focused and explains what is needed to start analysis", async () => {
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)
    await act(async () => root.render(<SectionDocument />))
    const editor = container.querySelector<HTMLTextAreaElement>(
      "#document-content-document-1",
    ) as HTMLTextAreaElement
    const name = container.querySelector<HTMLInputElement>(
      "#document-name-document-1",
    ) as HTMLInputElement
    const analyzeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "解析を開始する",
    ) as HTMLButtonElement
    const hint = document.getElementById(
      analyzeButton.getAttribute("aria-describedby") ?? "",
    ) as HTMLElement
    expect(analyzeButton.disabled).toBe(true)
    expect(hint.textContent).toContain(
      "本文を入力するか、ファイルを読み込んでください。",
    )

    editor.focus()
    await act(async () => changeInputValue(editor, "本文"))
    expect(analyzeButton.disabled).toBe(false)
    await act(async () => changeInputValue(editor, ""))
    expect(container.querySelector("#document-content-document-1")).toBe(editor)
    expect(document.activeElement).toBe(editor)
    expect(analyzeButton.disabled).toBe(true)

    await act(async () => changeInputValue(editor, "修正した本文"))
    await act(async () => changeInputValue(name, " "))
    expect(analyzeButton.disabled).toBe(true)
    expect(hint.textContent).toContain("書類名を入力してください。")
    await act(async () => changeInputValue(name, "研究計画書"))
    expect(analyzeButton.disabled).toBe(false)
    await act(async () => analyzeButton.click())
    expect(startAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: { "document-1": "修正した本文" },
        documentNames: { "document-1": "研究計画書" },
      }),
    )
    await act(async () => root.unmount())
  })

  it("includes document names in the length limit and clears the notice when corrected", async () => {
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)
    await act(async () => root.render(<SectionDocument />))
    const editor = container.querySelector<HTMLTextAreaElement>(
      "#document-content-document-1",
    ) as HTMLTextAreaElement
    const name = container.querySelector<HTMLInputElement>(
      "#document-name-document-1",
    ) as HTMLInputElement
    const analyzeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "解析を開始する",
    ) as HTMLButtonElement
    const hint = document.getElementById(
      analyzeButton.getAttribute("aria-describedby") ?? "",
    ) as HTMLElement
    await act(async () => changeInputValue(name, "書類"))
    await act(async () =>
      changeInputValue(
        editor,
        "あ".repeat(DOCUMENT_CONSTRAINTS.maxTotalGraphemes - 1),
      ),
    )
    expect(analyzeButton.disabled).toBe(true)
    expect(hint.textContent).toContain("上限を1字超えています。")
    await act(async () =>
      changeInputValue(
        editor,
        "あ".repeat(DOCUMENT_CONSTRAINTS.maxTotalGraphemes - 2),
      ),
    )
    expect(analyzeButton.disabled).toBe(false)
    expect(hint.textContent).not.toContain("超えています")
    await act(async () => root.unmount())
  })

  it("routes upload, edit, clear, and remove actions to the correct document key", async () => {
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionDocument />)
    })

    await act(async () => {
      container
        .querySelector('button[title="書類を追加"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("書類2")
    const addButton = container.querySelector('button[title="書類を追加"]')
    expect(addButton?.closest('[role="tablist"]')).toBeNull()
    expect(
      container.querySelectorAll('[role="tablist"] button:not([role="tab"])'),
    ).toHaveLength(0)

    await act(async () => {
      selectFile(container, "txt", "document-2")
    })

    expect(container.textContent).toMatch(/uploaded-document-\d+/)

    const editor = container.querySelector<HTMLTextAreaElement>(
      "#document-content-document-2",
    ) as HTMLTextAreaElement
    expect(editor.value).toBe("uploaded-document-2")
    await act(async () => changeInputValue(editor, `${editor.value}-edited`))
    expect(editor.value).toBe("uploaded-document-2-edited")

    await act(async () => {
      Array.from(container.querySelectorAll("#doc-panel-document-2 button"))
        .find((button) => button.textContent === "本文をクリア")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.querySelector("#document-content-document-2")).toBe(editor)
    expect(editor.value).toBe("")
    expect(
      container.querySelector('#doc-panel-document-2 input[type="file"]'),
    ).not.toBeNull()

    await act(async () => {
      Array.from(container.querySelectorAll("#doc-panel-document-2 button"))
        .find((button) => button.textContent === "この書類を削除")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.querySelector("#doc-panel-document-2")).toBeNull()
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.id,
    ).toBe("doc-tab-document-1")
    expect(document.activeElement?.id).toBe("doc-tab-document-1")
  })

  it.each(["", "second document body"])(
    "removes the selected document from its panel even when its body is %j",
    async (body) => {
      analysisJobMock.current = {
        jobId: "job-1",
        documents: { "document-1": "retained document", "document-2": body },
      }
      const { default: SectionDocument } = await import("./section-document")
      const root = createRoot(container)
      await act(async () => root.render(<SectionDocument />))
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>("#doc-tab-document-2")
          ?.click(),
      )

      expect(
        container.querySelector(
          '[role="tablist"] button[aria-label$="を削除"]',
        ),
      ).toBeNull()
      const deleteButton = container.querySelector<HTMLButtonElement>(
        '#doc-panel-document-2 button[aria-label="書類2 を削除"]',
      )
      expect(deleteButton).not.toBeNull()
      await act(async () => deleteButton?.click())

      expect(container.querySelector("#doc-panel-document-2")).toBeNull()
      expect(
        container.querySelector("#doc-panel-document-1")?.textContent,
      ).toContain("retained document")
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1)
      expect(container.querySelector('button[aria-label$="を削除"]')).toBeNull()
      expect(document.activeElement?.id).toBe("doc-tab-document-1")
      await act(async () => root.unmount())
    },
  )

  it("locks the document name during extraction and restores editing afterward", async () => {
    let finish!: (value: string) => void
    extractDocxTextMock.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    )
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SectionDocument />))
      await act(async () => {
        selectFile(container, "docx", "document-1")
      })
      const name = container.querySelector<HTMLInputElement>(
        "#document-name-document-1",
      ) as HTMLInputElement
      expect(name.disabled).toBe(true)
      await act(async () => finish("Imported document"))
      expect(name.disabled).toBe(false)
      expect(name.value).toBe("document-1.docx")
      await act(async () => changeInputValue(name, "研究計画書"))
      expect(name.value).toBe("研究計画書")
    } finally {
      await act(async () => root.unmount())
    }
  })

  it("handles docx, pptx, and unsupported upload branches", async () => {
    extractDocxTextMock.mockResolvedValue("docx-text")
    extractPptxTextMock.mockResolvedValue("pptx-text")

    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionDocument />)
    })

    await act(async () => {
      selectFile(container, "docx", "document-1")
    })
    expect(container.textContent).toContain("docx-text")

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "本文をクリア")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await act(async () => {
      selectFile(container, "pptx", "document-1")
    })
    expect(container.textContent).toContain("pptx-text")

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "本文をクリア")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    await act(async () => {
      selectFile(container, "bin", "document-1")
    })
    expect(container.textContent).toContain("対応していないファイル形式です。")
  })

  it("passes uploaded documents to analysis without discarding their text", async () => {
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionDocument />)
    })

    await act(async () => {
      selectFile(container, "txt", "document-1")
    })

    expect(container.textContent).toContain("uploaded-document-1")

    const analyzeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "解析を開始する",
    ) as HTMLButtonElement
    expect(analyzeButton.disabled).toBe(false)

    await act(async () => {
      analyzeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(startAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: {
          "document-1": "uploaded-document-1",
        },
      }),
    )
    expect(container.textContent).toContain("uploaded-document-1")
  })

  it("restores document editors from analysisJob when returning from the result step", async () => {
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)

    analysisJobMock.current = {
      jobId: "job-1",
      documents: {
        "document-1": "restored-application",
        "document-2": "restored-attachment",
      },
    }

    await act(async () => {
      root.render(<SectionDocument />)
    })

    expect(container.textContent).toContain("restored-application")
    expect(container.textContent).toContain("restored-attachment")
    expect(container.textContent).toContain("書類2")
  })

  it("shows a parse error when extraction fails", async () => {
    extractDocxTextMock.mockRejectedValue(new Error("parse failed"))

    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionDocument />)
    })

    await act(async () => {
      selectFile(container, "docx", "document-1")
    })

    expect(container.textContent).toContain(
      "ファイルを読み込めませんでした。形式・サイズ・本文の長さを確認してください。端末内で本文をテキストファイルに保存して読み込む方法もあります。",
    )
  })
  it("cancels extraction, permits another import, and ignores the old result", async () => {
    const pending = Promise.withResolvers<string>()
    extractDocxTextMock.mockReturnValueOnce(pending.promise)
    extractPptxTextMock.mockResolvedValueOnce("replacement text")
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)
    await act(async () => root.render(<SectionDocument />))
    await act(async () => selectFile(container, "docx"))
    const signal = extractDocxTextMock.mock.calls[0][1] as AbortSignal
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "読み込みを中止")
        ?.click(),
    )
    expect(signal.aborted).toBe(true)
    expect(container.textContent).toContain(
      "ファイルの読み込みを中止しました。",
    )
    await act(async () => selectFile(container, "pptx"))
    await act(async () => pending.resolve("stale text"))
    expect(container.querySelector("textarea")?.value).toBe("replacement text")
    expect(container.textContent).not.toContain("stale text")
  })

  it("aborts an active import on unmount", async () => {
    extractDocxTextMock.mockReturnValueOnce(new Promise(() => {}))
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)
    await act(async () => root.render(<SectionDocument />))
    await act(async () => selectFile(container, "docx"))
    const signal = extractDocxTextMock.mock.calls[0][1] as AbortSignal
    await act(async () => root.unmount())
    expect(signal.aborted).toBe(true)
  })
  it("uses editable document names, permits removal of the first document, and preserves names on submission", async () => {
    const { default: SectionDocument } = await import("./section-document")
    const root = createRoot(container)
    await act(async () => root.render(<SectionDocument />))
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[title="書類を追加"]')
        ?.click(),
    )
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>(
        "#document-name-document-2",
      ) as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set
      setter?.call(input, "説明文書")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(container.textContent).toContain("説明文書")
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("#doc-tab-document-1")
        ?.click(),
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '#doc-panel-document-1 button[aria-label="書類1 を削除"]',
        )
        ?.click(),
    )
    expect(container.querySelector("#document-name-document-1")).toBeNull()
    await act(async () => selectFile(container, "txt", "document-2"))
    const input = container.querySelector<HTMLInputElement>(
      "#document-name-document-2",
    ) as HTMLInputElement
    expect(input.value).toContain(".txt")
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "説明文書")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "解析を開始する")
        ?.click(),
    )
    expect(startAnalysisMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: { "document-2": "uploaded-document-2" },
        documentNames: { "document-2": "説明文書" },
      }),
    )
    await act(async () => root.unmount())
  })
})
