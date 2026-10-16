/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StepStateTransitionResult } from "@/features/app-context/app-context-types"
import { Stage } from "@/features/app-context/stage-types"
import {
  type DocumentDraft,
  EMPTY_DOCUMENT_DRAFT,
} from "@/features/document/document-draft-types"
import {
  readBrowserPayload,
  replaceBrowserPayload,
} from "@/lib/browser-session"
import { writeStoredResult } from "../../../test-support/browser-state"

const prepareNewAnalysisMock = vi.fn()
const resetToStartMock = vi.fn()
const updateStatusMock = vi.fn()
const returnToResultMock = vi.fn<() => Promise<StepStateTransitionResult>>()
const appContextValue: {
  prepareNewAnalysis: typeof prepareNewAnalysisMock
  resetToStart: typeof resetToStartMock
  returnToResult: typeof returnToResultMock
  stage: Stage
  result: { analysisId: string } | null
  documentDraft: DocumentDraft
} = {
  prepareNewAnalysis: prepareNewAnalysisMock,
  resetToStart: resetToStartMock,
  returnToResult: returnToResultMock,
  stage: Stage.followUp,
  result: { analysisId: "analysis-1" },
  documentDraft: EMPTY_DOCUMENT_DRAFT,
}

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => appContextValue,
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    updateStatusMessage: updateStatusMock,
  }),
}))

vi.mock("@/ui/card-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe("SectionThanks", () => {
  let container: HTMLDivElement

  beforeEach(async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    prepareNewAnalysisMock.mockReset()
    resetToStartMock.mockReset()
    updateStatusMock.mockReset()
    returnToResultMock.mockReset().mockResolvedValue({ ok: true })
    window.localStorage.clear()
    await writeStoredResult(null)
    appContextValue.documentDraft = EMPTY_DOCUMENT_DRAFT
    appContextValue.stage = Stage.followUp
    appContextValue.result = { analysisId: "analysis-1" }
    prepareNewAnalysisMock.mockResolvedValue({
      ok: true,
      resultCleared: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("shows a preparing state while returning to document preparation", async () => {
    const deferred = createDeferred<{ ok: true; resultCleared: true }>()
    prepareNewAnalysisMock.mockReturnValueOnce(deferred.promise)

    const { default: SectionThanks } = await import("./section-thanks")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionThanks />)
    })

    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "ブラウザー内の一時データを消去する",
    ) as HTMLButtonElement

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe("準備中...")

    await act(async () => {
      deferred.resolve({ ok: true, resultCleared: true })
      await deferred.promise
    })

    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe("ブラウザー内の一時データを消去する")
    expect(updateStatusMock).toHaveBeenCalledWith(null)
  })

  it.each([
    {
      failure: "transition",
      result: { ok: false },
      tone: "error",
      message: "状態の更新に失敗しました。時間をおいて再度お試しください。",
    },
    {
      failure: "cleanup",
      result: { ok: true, resultCleared: false },
      tone: "warning",
      message:
        "ブラウザー内の一時データの消去を完了できませんでした。ブラウザーの保存設定を確認して、消去を再試行してください。",
    },
    {
      failure: "transport",
      result: null,
      tone: "error",
      message: "状態の更新に失敗しました。時間をおいて再度お試しください。",
    },
  ])(
    "shows $failure feedback and allows another attempt",
    async ({ result, tone, message }) => {
      if (result === null) {
        prepareNewAnalysisMock.mockRejectedValueOnce(
          new Error("network unavailable"),
        )
      } else {
        prepareNewAnalysisMock.mockResolvedValueOnce(result)
      }
      const { default: SectionThanks } = await import("./section-thanks")
      const root = createRoot(container)
      try {
        await act(async () => root.render(<SectionThanks />))
        const button = Array.from(container.querySelectorAll("button")).find(
          (button) =>
            button.textContent === "ブラウザー内の一時データを消去する",
        )
        if (!button) throw new Error("Action button is missing")
        await act(async () => button.click())
        expect(updateStatusMock).toHaveBeenLastCalledWith({
          message,
          tone,
          ...(result?.ok && !result.resultCleared
            ? { recovery: "reload" }
            : {}),
        })
        expect(button.disabled).toBe(false)
        expect(button.textContent).toBe("ブラウザー内の一時データを消去する")

        await act(async () => button.click())
        expect(prepareNewAnalysisMock).toHaveBeenCalledTimes(2)
        expect(updateStatusMock).toHaveBeenLastCalledWith(null)
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it.each(["session_busy", "stale_session_state"] as const)(
    "handles %s when returning to the result instead of silently failing",
    async (reason) => {
      returnToResultMock.mockResolvedValueOnce({ ok: false, reason })
      const { default: SectionThanks } = await import("./section-thanks")
      const root = createRoot(container)
      try {
        await act(async () => root.render(<SectionThanks />))
        const button = [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "結果表示に戻る",
        )
        await act(async () => button?.click())
        expect(updateStatusMock).toHaveBeenLastCalledWith(
          expect.objectContaining(
            reason === "session_busy"
              ? {
                  tone: "warning",
                  message: expect.stringContaining("入力を保持"),
                }
              : { tone: "error", recovery: "reload" },
          ),
        )
        expect(prepareNewAnalysisMock).not.toHaveBeenCalled()
        expect(resetToStartMock).not.toHaveBeenCalled()
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it("offers document preparation after an accepted recovered survey without a result", async () => {
    appContextValue.result = null
    const { default: SectionThanks } = await import("./section-thanks")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SectionThanks />))
      await vi.waitFor(async () => {
        await act(async () => {})
        expect(container.textContent).toContain("書類の準備へ進む")
      })
      expect(container.textContent).not.toContain("結果表示に戻る")
      const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent === "書類の準備へ進む",
      )
      expect(button).toBeDefined()
      await act(async () => button?.click())
      expect(prepareNewAnalysisMock).toHaveBeenCalledOnce()
      expect(returnToResultMock).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it("keeps the deletion action available after RAM output clears but storage cleanup fails", async () => {
    await writeStoredResult("sealed")
    prepareNewAnalysisMock.mockImplementationOnce(async () => {
      appContextValue.result = null
      return { ok: true, resultCleared: false }
    })
    const { default: SectionThanks } = await import("./section-thanks")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SectionThanks />))
      const clear = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "ブラウザー内の一時データを消去する",
      )
      await act(async () => clear?.click())
      expect(clear?.textContent).toBe("ブラウザー内の一時データを消去する")
      expect(clear?.disabled).toBe(false)
      expect(container.textContent).not.toContain("結果表示に戻る")
      expect(container.textContent).not.toContain("書類の準備へ進む")
      await act(async () => clear?.click())
      expect(prepareNewAnalysisMock).toHaveBeenCalledTimes(2)
      expect(updateStatusMock).toHaveBeenLastCalledWith(null)
    } finally {
      await act(async () => root.unmount())
    }
  })

  it.each([
    "empty",
    "document",
    "file",
    "stored result",
    "recovered answers",
    "blocked storage",
  ])("chooses its action from %s data before any operation", async (data) => {
    appContextValue.result = null
    if (data === "document")
      appContextValue.documentDraft = {
        ...EMPTY_DOCUMENT_DRAFT,
        documents: { "document-1": "synthetic document" },
      }
    if (data === "file")
      appContextValue.documentDraft = {
        ...EMPTY_DOCUMENT_DRAFT,
        sourceFileNames: { "document-1": "synthetic.docx" },
      }
    if (data === "stored result") await writeStoredResult("sealed")
    if (data === "recovered answers")
      await replaceBrowserPayload(
        "recoveredSurvey",
        await readBrowserPayload("recoveredSurvey"),
        "sealed-draft",
      )
    if (data === "blocked storage")
      vi.spyOn(indexedDB, "open").mockImplementation(() => {
        throw new Error("blocked")
      })
    const { default: SectionThanks } = await import("./section-thanks")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SectionThanks />))
      const primary = [...container.querySelectorAll("button")].at(-1)
      await vi.waitFor(async () => {
        await act(async () => {})
        expect(primary?.textContent).toBe(
          data === "empty"
            ? "書類の準備へ進む"
            : "ブラウザー内の一時データを消去する",
        )
      })
      expect(prepareNewAnalysisMock).not.toHaveBeenCalled()
      expect(returnToResultMock).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it("updates its action when stored output changes independently of operations", async () => {
    appContextValue.result = null
    const { default: SectionThanks } = await import("./section-thanks")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<SectionThanks />))
      const button = container.querySelector("button")
      await vi.waitFor(async () => {
        await act(async () => {})
        expect(button?.textContent).toBe("書類の準備へ進む")
      })
      await act(async () => {
        await writeStoredResult("sealed")
      })
      await vi.waitFor(async () => {
        await act(async () => {})
        expect(button?.textContent).toBe("ブラウザー内の一時データを消去する")
      })
      await act(async () => {
        await writeStoredResult(null)
      })
      await vi.waitFor(async () => {
        await act(async () => {})
        expect(button?.textContent).toBe("書類の準備へ進む")
      })
      expect(prepareNewAnalysisMock).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it("offers reload without resetting shared state when the completed stage is missing", async () => {
    appContextValue.stage = Stage.authenticated

    const { default: SectionThanks } = await import("./section-thanks")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionThanks />)
    })

    expect(container.textContent).toContain("ページを再読み込み")
    expect(resetToStartMock).not.toHaveBeenCalled()
    expect(prepareNewAnalysisMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
