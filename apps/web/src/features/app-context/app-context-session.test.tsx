/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, expect, it, vi } from "vitest"
import { AppContextProvider, useAppContext } from "./app-context-provider"

const { status, admit, confirm, save, clear, browserListeners } = vi.hoisted(
  () => ({
    status: vi.fn(),
    admit: vi.fn(),
    confirm: vi.fn(),
    save: vi.fn(),
    clear: vi.fn(),
    browserListeners: new Set<() => void>(),
  }),
)
const scope = "22222222-2222-2222-2222-222222222222"
vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("@/features/app-context/actions-step-state", () => ({
  confirmAuthenticationAndPrepareAnalysisAction: confirm,
}))
vi.mock("@/features/session/actions-session", () => ({
  admitSessionAction: admit,
}))
vi.mock("@/features/session/session-status-client", () => ({
  fetchSessionStatus: status,
}))
vi.mock("@/lib/browser-database", () => ({
  readCachedBrowserSession: () => undefined,
  subscribeBrowserState: (listener: () => void) => {
    browserListeners.add(listener)
    return () => browserListeners.delete(listener)
  },
}))
vi.mock("@/lib/browser-session", () => ({
  getBrowserSession: async () => scope,
  commitBrowserAdmission: async () => true,
  captureBrowserAnalysis: async () => null,
  clearBrowserAnalysis: clear,
  readBrowserRecoveryRevision: () => 0,
  isBrowserSessionCurrent: () => true,
}))
vi.mock("@/features/llm/actions-record-presentation", () => ({
  recordResultPresentationAction: async () => ({ ok: true }),
}))
vi.mock("@/features/llm/analysis-result-storage", () => ({
  readAnalysisResultFromBrowser: async () => ({ ok: true, result: null }),
  saveAnalysisResultInBrowser: save,
  invalidateAnalysisResultStorageOperations: vi.fn(),
  prepareSurveySubmissionInBrowser: vi.fn(),
}))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  browserListeners.clear()
  clear.mockReset().mockResolvedValue(true)
  admit.mockResolvedValue({
    ok: true,
    scope,
    sessionToken: `${scope}:${"a".repeat(64)}`,
    stepState: { stage: "authenticated", step: "document" },
  })
  save.mockResolvedValue({ ok: true })
  status.mockReset()
  confirm.mockReset()
})
it("keeps tab-local result and documents without awake or cross-tab view synchronization", async () => {
  let context!: ReturnType<typeof useAppContext>
  function Probe() {
    context = useAppContext()
    return <p>{context.result?.text}</p>
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () =>
      root.render(
        <AppContextProvider
          initialStepState={{ stage: "authenticated", step: "document" }}
        >
          <Probe />
        </AppContextProvider>,
      ),
    )
    await act(async () => {
      context.updateDocumentDraft((draft) => ({
        ...draft,
        documents: { a: "local document" },
      }))
      await context.completeAnalysis({
        analysisId: "analysis-A",
        text: "retained result",
        analysisWorkspaceVersion: "1.0.0",
        modelName: "synthetic",
        processingDurationSeconds: 1,
        resultGraphemeCount: 15,
        documentCount: 1,
        documentGraphemeCount: 14,
      })
    })
    await act(async () => {
      for (const listener of browserListeners) listener()
    })
    expect(context.result?.text).toBe("retained result")
    expect(context.documentDraft.documents.a).toBe("local document")
    expect(status).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})
it("a stale action shows reload guidance and retains stored participant data", async () => {
  admit.mockResolvedValueOnce({
    ok: true,
    scope,
    sessionToken: `${scope}:${"a".repeat(64)}`,
    stepState: { stage: "confirmation_sent", step: "auth" },
  })
  confirm.mockResolvedValue({ ok: false, reason: "stale_session_state" })
  let context!: ReturnType<typeof useAppContext>
  function Probe() {
    context = useAppContext()
    return null
  }
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <AppContextProvider
          initialStepState={{ stage: "confirmation_sent", step: "auth" }}
        >
          <Probe />
        </AppContextProvider>,
      ),
    )
    await act(async () => {
      await context.confirmAuthentication()
    })
    expect(container.textContent).toContain("ページを再読み込み")
    expect(clear).not.toHaveBeenCalled()
    expect(container.querySelector('a[href="/reset"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})

vi.mock("@/features/llm/analysis-job-client", () => ({
  acknowledgeAnalysisResult: vi.fn(async () => {}),
}))
