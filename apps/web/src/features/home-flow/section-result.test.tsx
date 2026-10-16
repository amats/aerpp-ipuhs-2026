/** @vitest-environment jsdom */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AnalysisResult } from "@/features/app-context/analysis-result-types"
import type {
  CompleteAnalysisResult,
  StepStateTransitionResult,
} from "@/features/app-context/app-context-types"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"

const appContextValue = {
  stage: Stage.followUp as Stage,
  rootStep: RootStep.result as RootStep,
  analysisJob: null as {
    jobId: string
    documents: Record<string, string>
  } | null,
  result: null as AnalysisResult | null,
  cancelAnalysis: vi.fn(async () => undefined),
  recoverUnavailableAnalysis: vi.fn<
    (id: string) => Promise<StepStateTransitionResult>
  >(async () => ({ ok: true })),
  completeAnalysis: vi.fn<
    (
      result: AnalysisResult,
      signal?: AbortSignal,
    ) => Promise<CompleteAnalysisResult>
  >(async () => ({ ok: true, resultStored: true })),
  failAnalysis: vi.fn<() => Promise<StepStateTransitionResult>>(async () => ({
    ok: true,
  })),
  prepareNewAnalysis: vi.fn(async () => ({
    ok: true,
    resultCleared: true,
  })),
  startSurvey: vi.fn(async () => ({
    ok: true,
  })),
  resetToStart: vi.fn(async () => undefined),
}
const updateStatusMock = vi.fn()
const saveAsMock = vi.fn()
const asBlobMock = vi.fn(
  async (_html: string) =>
    new Blob(["docx"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
)

vi.mock("file-saver", () => ({
  default: saveAsMock,
}))

vi.mock("html-docx-js-typescript", () => ({
  asBlob: asBlobMock,
}))

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => appContextValue,
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    updateStatusMessage: updateStatusMock,
  }),
}))

const validateResultMock = vi.fn(async () => ({ ok: true }))
vi.mock("@/features/llm/actions-validate-result", () => ({
  validateResultAction: validateResultMock,
}))
const requestJobMock = vi.fn()
const startJobMock = vi.fn()
const resultRequestMock = vi.fn()
const finalizeAnalysisActionMock = vi.fn()

vi.mock("@/features/llm/analysis-job-client", () => ({
  requestAnalysisJob: async (args: {
    documents?: unknown
    analysisId?: string
    signal: AbortSignal
  }) => {
    if (args.documents) return startJobMock(args)
    if (args.analysisId) return resultRequestMock(args)
    return requestJobMock(args)
  },
  waitForAnalysisPoll: (signal: AbortSignal) => waitForAbort({ signal }),
}))
const retryAnalysisMock = vi.fn()
const retryRecordingMock = vi.fn()
vi.mock("@/features/llm/actions-analysis-job", () => ({
  retryAnalysisAction: retryAnalysisMock,
  retryAnalysisJobRecordingAction: retryRecordingMock,
}))

vi.mock("@/features/llm/actions-finalize-analysis", () => ({
  finalizeAnalysisAction: finalizeAnalysisActionMock,
}))

function createResult(text: string): AnalysisResult {
  return {
    analysisId: "analysis-1",
    analysisWorkspaceVersion: "1.0.0",
    modelName: "local",
    processingDurationSeconds: 1,
    documentCount: 1,
    documentGraphemeCount: 10,
    resultGraphemeCount: text.length,
    text,
  }
}

async function waitForAbort({ signal }: { signal: AbortSignal }) {
  await new Promise<void>((_, reject) => {
    if (signal.aborted) return reject(signal.reason)
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    })
  })
}

describe("SectionResult", () => {
  let container: HTMLDivElement
  let root: Root
  let SectionResult: typeof import("./section-result").default

  async function renderResult() {
    await act(async () => root.render(<SectionResult />))
  }

  beforeEach(async () => {
    SectionResult = (await import("./section-result")).default
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "performance",
      ],
    })
    vi.setSystemTime(new Date("2026-04-14T00:00:00.000Z"))
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    appContextValue.stage = Stage.followUp
    appContextValue.rootStep = RootStep.result
    appContextValue.analysisJob = null
    appContextValue.result = null
    appContextValue.cancelAnalysis.mockReset()
    appContextValue.recoverUnavailableAnalysis
      .mockReset()
      .mockResolvedValue({ ok: true })
    appContextValue.completeAnalysis.mockReset()
    appContextValue.completeAnalysis.mockResolvedValue({
      ok: true,
      resultStored: true,
    })
    appContextValue.failAnalysis.mockReset()
    appContextValue.failAnalysis.mockResolvedValue({ ok: true })
    appContextValue.prepareNewAnalysis.mockReset()
    appContextValue.prepareNewAnalysis.mockResolvedValue({
      ok: true,
      resultCleared: true,
    })
    appContextValue.resetToStart.mockReset()
    appContextValue.startSurvey.mockReset()
    appContextValue.startSurvey.mockResolvedValue({
      ok: true,
    })
    updateStatusMock.mockReset()
    retryAnalysisMock.mockReset().mockResolvedValue({ ok: false })
    retryRecordingMock
      .mockReset()
      .mockResolvedValue({ ok: false, reason: "completion_failed" })
    requestJobMock.mockReset().mockResolvedValue({
      ok: true,
      analysisId: null,
      status: "idle",
      startedAtMs: null,
      elapsedMs: null,
    })
    resultRequestMock.mockReset()
    startJobMock.mockReset().mockImplementation(() => requestJobMock())
    finalizeAnalysisActionMock.mockReset()
    finalizeAnalysisActionMock.mockResolvedValue({
      ok: true,
      metadata: {
        analysisId: "analysis-1",
        analysisWorkspaceVersion: "1.0.0",
        modelName: "model-1",
        processingDurationSeconds: 0,
        documentCount: 2,
        documentGraphemeCount: 10,
        resultGraphemeCount: 14,
      },
    })
    saveAsMock.mockReset()
    asBlobMock.mockReset()
  })

  it("shows a preparing state while returning to document preparation", async () => {
    let resolvePrepare!: (value: { ok: true; resultCleared: true }) => void
    const preparePromise = new Promise<{ ok: true; resultCleared: true }>(
      (resolve) => {
        resolvePrepare = resolve
      },
    )
    appContextValue.prepareNewAnalysis.mockReturnValueOnce(preparePromise)

    appContextValue.result = createResult("completed result")

    await renderResult()

    const backButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("ブラウザー内の一時データを消去する"),
    ) as HTMLButtonElement

    await act(async () => {
      backButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(appContextValue.prepareNewAnalysis).toHaveBeenCalledTimes(1)
    expect(backButton.disabled).toBe(true)
    expect(backButton.textContent).toBe("準備中...")

    await act(async () => {
      resolvePrepare({ ok: true, resultCleared: true })
      await preparePromise
    })

    expect(backButton.disabled).toBe(false)
    expect(backButton.textContent).toBe("ブラウザー内の一時データを消去する")
    expect(updateStatusMock).toHaveBeenCalledWith(null)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    container.remove()
  })

  it("keeps both save actions synchronized above and below the result", async () => {
    let resolveBlob!: (value: Blob) => void
    const blobPromise = new Promise<Blob>((resolve) => {
      resolveBlob = resolve
    })
    asBlobMock.mockReturnValueOnce(blobPromise)

    appContextValue.result = createResult("result body")

    await renderResult()

    const wordButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Word形式で保存"),
    )
    expect(wordButtons).toHaveLength(2)
    const [topSaveButton, bottomSaveButton] = wordButtons
    const body = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent === "result body",
    ) as HTMLParagraphElement
    const status = container.querySelector('[role="status"]') as HTMLElement
    expect(status.textContent).toBe("解析が終了しました。")
    expect(
      status.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      topSaveButton.compareDocumentPosition(body) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      body.compareDocumentPosition(bottomSaveButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await act(async () => {
      bottomSaveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    for (const button of wordButtons) {
      expect(button.disabled).toBe(true)
      expect(button.textContent).toBe("保存ファイルを作成中...")
    }
    await act(async () => topSaveButton.click())
    await vi.dynamicImportSettled()
    expect(asBlobMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveBlob(
        new Blob(["docx"], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      )
      await blobPromise
    })

    expect(saveAsMock).toHaveBeenCalledWith(
      await blobPromise,
      "AERPP-20260414.docx",
    )

    for (const button of wordButtons) {
      expect(button.disabled).toBe(false)
      expect(button.textContent).toBe("Word形式で保存")
    }
  })

  it("replaces questionnaire instructions with confirmation for a submitted result", async () => {
    appContextValue.result = {
      ...createResult("completed result"),
      surveySubmitted: true,
    }

    await renderResult()

    expect(container.textContent).toContain(
      "この解析のアンケートは送信済みです。再回答は不要です。",
    )
    expect(container.textContent).not.toContain("アンケートへのご協力")
    expect(container.textContent).not.toContain("入力中の回答")
    expect(container.textContent).not.toContain("アンケートにお進み")
    expect(container.textContent).not.toContain("アンケートを開く")
    expect(container.textContent).toContain(
      "必要に応じてWord形式で保存できます。",
    )
    expect(container.textContent).toContain(
      "ブラウザー内の一時データを消去する",
    )
  })

  it.each(["success", "busy", "save_failure", "transport_failure", "missing"])(
    "restores survey controls after a %s response",
    async (outcome) => {
      type SurveyTransition = { ok: true } | { ok: false; reason: string }
      let resolveSurvey: (value: SurveyTransition) => void = () => {}
      let rejectSurvey!: (error: Error) => void
      const surveyPromise = new Promise<SurveyTransition>((resolve, reject) => {
        resolveSurvey = resolve
        rejectSurvey = reject
      })
      appContextValue.startSurvey.mockReturnValueOnce(surveyPromise)

      appContextValue.result = createResult("completed result")

      await renderResult()

      const surveyButton = Array.from(
        container.querySelectorAll("button"),
      ).find((button) =>
        button.textContent?.includes("アンケートを開く"),
      ) as HTMLButtonElement

      await act(async () => {
        surveyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })

      expect(appContextValue.startSurvey).toHaveBeenCalledTimes(1)
      expect(surveyButton.disabled).toBe(true)
      expect(surveyButton.textContent).toBe("移動中...")

      await act(async () => {
        if (outcome === "transport_failure")
          rejectSurvey(new Error("network unavailable"))
        else
          resolveSurvey(
            outcome === "success"
              ? { ok: true }
              : {
                  ok: false,
                  reason:
                    outcome === "busy"
                      ? "session_busy"
                      : outcome === "missing"
                        ? "no_result"
                        : "step_state_write_failed",
                },
          )
        await surveyPromise.catch(() => undefined)
      })

      expect(surveyButton.disabled).toBe(false)
      expect(surveyButton.textContent).toBe("アンケートを開く")
      if (outcome === "success")
        expect(updateStatusMock).toHaveBeenLastCalledWith(null)
      if (outcome === "busy") {
        expect(updateStatusMock).toHaveBeenCalledWith({
          message:
            "別の処理が進行中か、前の処理の終了を確認できません。入力を保持したまま、時間をおいて同じ操作を再試行してください。同じ状態が続く場合は、研究者にご連絡ください。",
          tone: "warning",
        })
        expect(appContextValue.resetToStart).not.toHaveBeenCalled()
      }
      if (
        outcome === "save_failure" ||
        outcome === "transport_failure" ||
        outcome === "missing"
      ) {
        expect(updateStatusMock).toHaveBeenLastCalledWith({
          message:
            outcome === "missing"
              ? "解析結果を確認できませんでした。ページを再読み込みして現在の状態を確認してください。"
              : "アンケートへ進めませんでした。時間をおいて、もう一度お試しください。",
          tone: "error",
        })
        expect(container.textContent).toContain("completed result")
        expect(appContextValue.resetToStart).not.toHaveBeenCalled()
        await act(async () => surveyButton.click())
        expect(appContextValue.startSurvey).toHaveBeenCalledTimes(2)
        expect(updateStatusMock).toHaveBeenLastCalledWith(null)
      }
      await act(async () => root.unmount())
    },
  )

  function provideJob() {
    appContextValue.analysisJob = {
      jobId: "job-1",
      documents: { doc: "synthetic input" },
    }
    requestJobMock
      .mockResolvedValue({
        ok: true,
        analysisId: "analysis-1",
        status: "ready",
        startedAtMs: Date.now(),
        elapsedMs: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        analysisId: null,
        status: "idle",
        startedAtMs: null,
        elapsedMs: null,
      })
    startJobMock.mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      status: "ready",
      startedAtMs: Date.now(),
      elapsedMs: 0,
    })
    resultRequestMock.mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      text: "completed synthetic output",
      receipt: "original-receipt",
    })
  }

  it("starts once with named documents and finalizes the complete response", async () => {
    provideJob()
    appContextValue.analysisJob = {
      jobId: "job-1",
      documents: { a: "doc-a", b: "doc-b" },
    }
    await renderResult()
    expect(startJobMock).toHaveBeenCalledWith({
      documents: [
        { name: "書類", text: "doc-a" },
        { name: "書類", text: "doc-b" },
      ],
      signal: expect.any(AbortSignal),
    })
    expect(finalizeAnalysisActionMock).toHaveBeenCalledWith(
      "original-receipt",
      undefined,
    )
    expect(appContextValue.completeAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ text: "completed synthetic output" }),
      expect.any(AbortSignal),
    )
  })

  it.each(["rejected", "response-lost"])(
    "retains hidden output and retries only finalization after %s",
    async (failure) => {
      provideJob()
      if (failure === "rejected")
        finalizeAnalysisActionMock.mockResolvedValueOnce({
          ok: false,
          reason: "finalize_failed",
        })
      else
        finalizeAnalysisActionMock.mockRejectedValueOnce(
          new Error("response lost"),
        )
      await renderResult()
      expect(container.textContent).not.toContain("completed synthetic output")
      expect(appContextValue.completeAnalysis).not.toHaveBeenCalled()
      const retry = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "完了処理を再試行",
      ) as HTMLButtonElement
      await act(async () => retry.click())
      expect(
        finalizeAnalysisActionMock.mock.calls.map(([receipt]) => receipt),
      ).toEqual(["original-receipt", "original-receipt"])
      expect(startJobMock).toHaveBeenCalledTimes(1)
      expect(resultRequestMock).toHaveBeenCalledTimes(1)
      expect(appContextValue.completeAnalysis).toHaveBeenCalledOnce()
    },
  )

  it("does not save a delayed completion after navigation", async () => {
    provideJob()
    let finish!: (value: unknown) => void
    finalizeAnalysisActionMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await renderResult()
    await act(async () => root.render(<div>download route</div>))
    await act(async () =>
      finish({ ok: true, metadata: createResult("unused") }),
    )
    expect(appContextValue.completeAnalysis).not.toHaveBeenCalled()
    expect(appContextValue.cancelAnalysis).not.toHaveBeenCalled()
  })

  it("retries browser storage without another model request or result read", async () => {
    provideJob()
    appContextValue.completeAnalysis.mockResolvedValueOnce({
      ok: true,
      resultStored: false,
    })
    await renderResult()
    expect(container.textContent).toContain("解析結果を保持しています")
    expect(container.querySelector(".prose")).toBeNull()
    const retry = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "完了処理を再試行",
    ) as HTMLButtonElement
    await act(async () => retry.click())
    expect(appContextValue.completeAnalysis).toHaveBeenCalledTimes(2)
    expect(startJobMock).toHaveBeenCalledTimes(1)
    expect(resultRequestMock).toHaveBeenCalledTimes(1)
  })

  it("retains output and the original receipt while completion storage is busy", async () => {
    provideJob()
    appContextValue.completeAnalysis.mockResolvedValueOnce({
      ok: false,
      reason: "session_busy",
    })
    await renderResult()
    expect(container.textContent).not.toContain("completed synthetic output")
    expect(updateStatusMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("入力を保持したまま"),
      }),
    )
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "完了処理を再試行",
    )
    expect(retry).toBeDefined()
    await act(async () => retry?.click())
    expect(
      finalizeAnalysisActionMock.mock.calls.map(([receipt]) => receipt),
    ).toEqual(["original-receipt", "original-receipt"])
    expect(appContextValue.completeAnalysis).toHaveBeenCalledTimes(2)
    expect(startJobMock).toHaveBeenCalledOnce()
    expect(resultRequestMock).toHaveBeenCalledOnce()
  })

  it("retries only the failed attempt's terminal record before offering inference retry", async () => {
    appContextValue.analysisJob = { jobId: "resume", documents: {} }
    const pending = {
      ok: true,
      analysisId: "analysis-1",
      status: "termination_pending",
      startedAtMs: null,
      elapsedMs: null,
    }
    requestJobMock.mockResolvedValue(pending)
    await renderResult()
    expect(container.textContent).not.toContain("解析を再試行")
    expect(container.textContent).not.toContain("解析が続いている可能性")
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "終了記録を再試行",
    )
    expect(retry).toBeDefined()
    retryRecordingMock.mockRejectedValueOnce(new Error("offline"))
    await act(async () => retry?.click())
    expect(container.textContent).toContain("終了記録を再試行")
    expect(requestJobMock).toHaveBeenCalledOnce()
    requestJobMock.mockResolvedValue({
      ...pending,
      status: "failed",
      canRetry: true,
    })
    retryRecordingMock.mockResolvedValueOnce({ ok: true })
    await act(async () => retry?.click())
    expect(retryRecordingMock).toHaveBeenCalledWith("analysis-1", undefined)
    expect(container.textContent).toContain("解析を再試行")
    expect(container.textContent).not.toContain("終了記録を再試行")
    expect(retryAnalysisMock).not.toHaveBeenCalled()
    expect(startJobMock).not.toHaveBeenCalled()
    expect(resultRequestMock).not.toHaveBeenCalled()
    expect(appContextValue.failAnalysis).not.toHaveBeenCalled()
  })

  it("rechecks an uncertain inference retry before offering another model request", async () => {
    appContextValue.analysisJob = { jobId: "resume", documents: {} }
    requestJobMock.mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      status: "failed",
      startedAtMs: null,
      elapsedMs: null,
      canRetry: true,
    })
    retryAnalysisMock.mockRejectedValueOnce(new Error("Response lost"))
    await renderResult()
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "解析を再試行",
    )
    await act(async () => retry?.click())
    expect(retryAnalysisMock).toHaveBeenCalledOnce()
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "解析を再試行",
      ),
    ).toBe(false)
    const reconnect = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "接続を再確認",
    )
    expect(reconnect).toBeDefined()
    requestJobMock.mockResolvedValue({
      ok: true,
      analysisId: "analysis-2",
      status: "running",
      startedAtMs: null,
      elapsedMs: null,
    })
    await act(async () => reconnect?.click())
    expect(retryAnalysisMock).toHaveBeenCalledOnce()
    expect(requestJobMock).toHaveBeenCalledTimes(2)
    expect(startJobMock).not.toHaveBeenCalled()
  })

  it("rechecks status after a lost response without resubmitting documents", async () => {
    provideJob()
    startJobMock.mockRejectedValueOnce(new Error("response lost"))
    requestJobMock.mockResolvedValue({
      ok: true,
      analysisId: null,
      status: "idle",
      startedAtMs: null,
      elapsedMs: null,
    })
    await renderResult()
    expect(container.textContent).toContain("接続を再確認")
    const reconnect = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "接続を再確認",
    ) as HTMLButtonElement
    await act(async () => reconnect.click())
    expect(startJobMock).toHaveBeenCalledTimes(1)
    expect(appContextValue.failAnalysis).not.toHaveBeenCalled()
    expect(container.querySelector("[data-analysis-animation]")).toBeNull()
  })

  it("offers explicit document recovery only after a confirmed failure", async () => {
    provideJob()
    requestJobMock.mockReset().mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      status: "failed",
      startedAtMs: Date.now(),
      elapsedMs: 0,
      canRetry: true,
    })
    appContextValue.failAnalysis.mockRejectedValueOnce(
      new Error("temporary failure"),
    )
    await renderResult()
    expect(container.textContent).toContain("解析は停止しています")
    expect(appContextValue.failAnalysis).not.toHaveBeenCalled()
    const recover = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "書類の準備へ戻る",
    ) as HTMLButtonElement
    await act(async () => recover.click())
    expect(recover.disabled).toBe(false)
    await act(async () => recover.click())
    expect(appContextValue.failAnalysis).toHaveBeenCalledTimes(2)
    expect(startJobMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain("解析を再試行")
  })

  it.each([-90_000, 90_000])(
    "advances elapsed time while the server clock differs by %s ms",
    async (clockOffsetMs) => {
      provideJob()
      const runningStatus = {
        ok: true,
        analysisId: "analysis-1",
        status: "running",
        startedAtMs: Date.now() + clockOffsetMs,
        elapsedMs: 0,
      }
      requestJobMock.mockReset().mockResolvedValue(runningStatus)
      await renderResult()
      expect(
        container.querySelector("[data-analysis-animation]"),
      ).not.toBeNull()
      expect(container.textContent).toContain("解析中です...")
      expect(container.textContent).toContain("経過時間 0分00秒")
      await act(async () => vi.advanceTimersByTime(1000))
      expect(container.textContent).toContain("経過時間 0分01秒")
      await act(async () => vi.advanceTimersByTime(1000))
      expect(container.textContent).toContain("経過時間 0分02秒")
      expect(appContextValue.cancelAnalysis).not.toHaveBeenCalled()
    },
  )

  it("restores server elapsed time after remount and ignores browser clock changes", async () => {
    provideJob()
    const startedAtMs = Date.now() + 90_000
    requestJobMock.mockReset().mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      status: "running",
      startedAtMs,
      elapsedMs: 90_000,
    })
    await renderResult()
    expect(container.textContent).toContain("経過時間 1分30秒")
    vi.setSystemTime(Date.now() - 120_000)
    await act(async () => vi.advanceTimersByTime(1000))
    expect(container.textContent).toContain("経過時間 1分31秒")
    await act(async () => vi.advanceTimersByTime(1000))
    expect(container.textContent).toContain("経過時間 1分32秒")
    await act(async () => root.unmount())
    await vi.advanceTimersByTimeAsync(3000)
    requestJobMock.mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      status: "running",
      startedAtMs,
      elapsedMs: 95_000,
    })
    root = createRoot(container)
    await renderResult()
    expect(container.textContent).toContain("経過時間 1分35秒")
    await act(async () => vi.advanceTimersByTime(1000))
    expect(container.textContent).toContain("経過時間 1分36秒")
    expect(startJobMock).not.toHaveBeenCalled()
  })

  it("aborts only browser observation on unmount", async () => {
    provideJob()
    requestJobMock.mockReset().mockImplementation(waitForAbort)
    await renderResult()
    const signal = requestJobMock.mock.calls[0][0].signal as AbortSignal
    await act(async () => root.render(<div>other route</div>))
    expect(signal.aborted).toBe(true)
    expect(appContextValue.cancelAnalysis).not.toHaveBeenCalled()
    expect(startJobMock).not.toHaveBeenCalled()
  })

  it("does not duplicate a live observation across rerenders or StrictMode replay", async () => {
    provideJob()
    requestJobMock.mockReset().mockImplementation(waitForAbort)
    await act(async () =>
      root.render(
        <StrictMode>
          <SectionResult />
        </StrictMode>,
      ),
    )
    await act(async () =>
      root.render(
        <StrictMode>
          <SectionResult />
        </StrictMode>,
      ),
    )
    expect(
      requestJobMock.mock.calls.filter(
        ([args]) => args.signal.aborted !== true,
      ),
    ).toHaveLength(1)
    expect(startJobMock).not.toHaveBeenCalled()
    expect(appContextValue.cancelAnalysis).not.toHaveBeenCalled()
  })
  it("keeps tables and preformatted text in named keyboard-focusable regions", async () => {
    appContextValue.result = createResult(
      "| 項目 | 内容 |\n| --- | --- |\n| 確認 | 本文 |\n\n```text\n  synthetic code\n    preserved indentation\n```",
    )
    await renderResult()

    for (const label of ["解析結果の表", "解析結果のコード"]) {
      const region = container.querySelector<HTMLElement>(
        `section[aria-label="${label}"]`,
      )
      expect(region).not.toBeNull()
      expect(region?.tabIndex).toBe(0)
      region?.focus()
      expect(document.activeElement).toBe(region)
    }
    expect(container.querySelector("table")?.textContent).toContain("本文")
    expect(container.querySelector("pre code")?.textContent).toBe(
      "  synthetic code\n    preserved indentation\n",
    )
    await act(async () => root.unmount())
  })

  it("renders ordinary and escaped whitespace in display and Word without changing code, links or stored results", async () => {
    const text = [
      "## 見出し",
      "該当箇所：\\t例\\n懸念内容：例\\r\\n理由：例",
      "既存の段落\n通常の改行",
      "通常のタブ\tと連続したタブ\\t\\tの間隔",
      "CRLFの段落\r\n次の行",
      "| 項目 | 内容 |\n| --- | --- |\n| 確認 | 前半\\t中間\\n後半 |",
      "`文字列\\n\\tの例`",
      "```text\nコード\\n\\tの例\n  次のコード行\n```",
      "[参考](https://example.invalid/path?q=literal\\n\\t)",
      "明示的な改行  \n次の行",
    ].join("\n\n")
    appContextValue.result = createResult(text)
    await renderResult()

    const rendered = container.querySelector(".prose") as HTMLElement
    expect(rendered.querySelector("h2")?.textContent).toBe("見出し")
    expect(rendered.querySelector("p")?.innerHTML).toBe(
      "該当箇所：\t例<br>\n懸念内容：例<br>\n理由：例",
    )
    expect(rendered.innerHTML).toContain("既存の段落<br>\n通常の改行")
    expect(rendered.textContent).toContain(
      "通常のタブ\tと連続したタブ\t\tの間隔",
    )
    expect(rendered.innerHTML).toContain("CRLFの段落<br>\n次の行")
    expect(rendered.innerHTML).toContain("明示的な改行<br>\n次の行")
    expect(rendered.querySelector("td:last-child")?.innerHTML).toBe(
      "前半\t中間<br>\n後半",
    )
    expect(rendered.querySelector("p code")?.textContent).toBe(
      "文字列\\n\\tの例",
    )
    expect(rendered.querySelector("pre code")?.textContent).toBe(
      "コード\\n\\tの例\n  次のコード行\n",
    )
    const link = rendered.querySelector("a")
    expect(link?.getAttribute("href")).toBe(
      "https://example.invalid/path?q=literal%5Cn%5Ct",
    )

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Word形式で保存",
    ) as HTMLButtonElement
    await act(async () => saveButton.click())
    const html = asBlobMock.mock.calls[0][0]
    expect(html).toContain("該当箇所：\t例<br>\n懸念内容：例<br>\n理由：例")
    expect(html).toContain("既存の段落<br>\n通常の改行")
    expect(html).toContain("通常のタブ\tと連続したタブ\t\tの間隔")
    expect(html).toContain("CRLFの段落<br>\n次の行")
    expect(html).toContain("明示的な改行<br>\n次の行")
    expect(html).toContain("前半\t中間<br>\n後半")
    expect(html).toContain("文字列\\n\\tの例")
    expect(html).toContain("コード\\n\\tの例\n  次のコード行\n")
    expect(html).toContain(
      'href="https://example.invalid/path?q=literal%5Cn%5Ct"',
    )
    expect(appContextValue.result.text).toBe(text)
    await act(async () => root.unmount())
  })

  it.each([
    "![画像](https://collector.example/image?data=synthetic)",
    "![画像][ref]\n\n[ref]: //collector.example/image",
    "[![画像](https://collector.example/image)](https://example.invalid/reference)",
    '<img src="https://collector.example/image">',
  ])(
    "blocks image requests in display and Word output: %s",
    async (imageMarkdown) => {
      appContextValue.result = createResult(
        `${imageMarkdown}\n\n| 項目 | 内容 |\n| --- | --- |\n| 確認 | 本文 |\n\n[参考](https://example.invalid/reference)`,
      )
      await renderResult()
      expect(container.querySelector("img")).toBeNull()
      expect(container.querySelector("table")?.textContent).toContain("本文")
      expect(
        container.querySelector('a[href="https://example.invalid/reference"]'),
      ).not.toBeNull()
      const saveButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Word形式で保存",
      ) as HTMLButtonElement
      await act(async () =>
        saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      )
      const html = asBlobMock.mock.calls[0][0] as string
      expect(html).not.toMatch(/<img\b/i)
      expect(html).not.toContain("collector.example")
      expect(html).toContain("<table")
      expect(html).toContain('href="https://example.invalid/reference"')
      await act(async () => root.unmount())
    },
  )
  it.each([Stage.authenticated, Stage.followUp])(
    "automatically returns lost unpresented output to preparation without inference (%s)",
    async (stage) => {
      appContextValue.stage = stage
      appContextValue.analysisJob = { jobId: "resume", documents: {} }
      requestJobMock.mockResolvedValue({
        ok: true,
        analysisId: "analysis-1",
        status: "unavailable",
        startedAtMs: null,
        elapsedMs: null,
        canRecover: true,
      })
      await renderResult()
      expect(
        appContextValue.recoverUnavailableAnalysis,
      ).toHaveBeenCalledExactlyOnceWith("analysis-1")
      expect(startJobMock).not.toHaveBeenCalled()
      await renderResult()
      expect(appContextValue.recoverUnavailableAnalysis).toHaveBeenCalledOnce()
    },
  )
  it("rechecks and retries a failed output-loss recovery only after explicit reconnection", async () => {
    appContextValue.analysisJob = { jobId: "resume", documents: {} }
    requestJobMock.mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      status: "unavailable",
      startedAtMs: null,
      elapsedMs: null,
      canRecover: true,
    })
    appContextValue.recoverUnavailableAnalysis.mockResolvedValueOnce({
      ok: false,
      reason: "analysis_recovery_unavailable",
    })
    await renderResult()
    expect(appContextValue.recoverUnavailableAnalysis).toHaveBeenCalledOnce()
    await renderResult()
    expect(appContextValue.recoverUnavailableAnalysis).toHaveBeenCalledOnce()
    const reconnect = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "接続を再確認",
    )
    await act(async () => reconnect?.click())
    expect(requestJobMock).toHaveBeenCalledTimes(2)
    expect(appContextValue.recoverUnavailableAnalysis).toHaveBeenCalledTimes(2)
    expect(startJobMock).not.toHaveBeenCalled()
  })

  it("animates confirmed output-loss recovery while its acknowledgement is pending", async () => {
    let finishRecovery: (() => void) | undefined
    appContextValue.recoverUnavailableAnalysis.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRecovery = () => resolve({ ok: true })
        }),
    )
    appContextValue.analysisJob = { jobId: "resume", documents: {} }
    requestJobMock.mockResolvedValue({
      ok: true,
      analysisId: "analysis-1",
      status: "unavailable",
      startedAtMs: null,
      elapsedMs: null,
      canRecover: true,
    })
    await renderResult()
    expect(container.textContent).toContain(
      "書類の準備への復帰を確認しています。",
    )
    expect(container.textContent).not.toContain(
      "解析が続いている可能性があります。",
    )
    expect(container.querySelector("[data-analysis-animation]")).not.toBeNull()
    const reconnect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "接続を再確認",
    )
    expect(reconnect?.disabled).toBe(true)
    expect(startJobMock).not.toHaveBeenCalled()
    await act(async () => finishRecovery?.())
    expect(container.querySelector("[data-analysis-animation]")).toBeNull()
    expect(container.textContent).toContain(
      "解析は終了していますが、結果を取得できません。",
    )
  })
  it.each(["unavailable", "unconfirmed", "running", "completion_pending"])(
    "does not automatically recover protected or retained output (%s)",
    async (status) => {
      appContextValue.analysisJob = { jobId: "resume", documents: {} }
      requestJobMock.mockResolvedValue({
        ok: true,
        analysisId: "analysis-1",
        status,
        startedAtMs: null,
        elapsedMs: null,
        canRecover: false,
      })
      await renderResult()
      expect(appContextValue.recoverUnavailableAnalysis).not.toHaveBeenCalled()
      expect(startJobMock).not.toHaveBeenCalled()
    },
  )
})
