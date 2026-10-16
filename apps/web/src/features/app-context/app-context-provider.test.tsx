/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  AnalysisResult,
  AnalysisResultReadOutcome,
  AnalysisResultWriteOutcome,
} from "@/features/app-context/analysis-result-types"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import { EMPTY_DOCUMENT_DRAFT } from "@/features/document/document-draft-types"
import { EMPTY_CONSENT_DRAFT } from "@/features/home-flow/consent-draft-types"
import { activateTabOperations } from "@/lib/tab-cancellation"
import { setTabToken } from "@/lib/tab-token"
import { initialDefinitionId } from "../../../test-support/questionnaires"
import type { useAppContext } from "./app-context-provider"
import type { StepState } from "./step-state-types"

const readResultInStorageMock =
  vi.fn<() => Promise<AnalysisResultReadOutcome>>()
const saveResultInStorageMock =
  vi.fn<() => Promise<AnalysisResultWriteOutcome>>()
const moveToExplanationActionMock = vi.fn()
const moveToConsentActionMock = vi.fn()
const sendConsentEmailAndMoveToAuthActionMock = vi.fn()
const confirmAuthenticationAndPrepareAnalysisActionMock = vi.fn()
const prepareNewAnalysisActionMock = vi.fn()
const startAnalysisActionMock = vi.fn()
const failAnalysisActionMock = vi.fn()
const cancelAnalysisActionMock = vi.fn()
const recoverUnavailableAnalysisActionMock = vi.fn()
const startSurveyActionMock = vi.fn()
const returnToResultActionMock = vi.fn()
const completeSurveySubmissionActionMock = vi.fn()
const completeWithdrawalActionMock = vi.fn()
const correctConsentEmailActionMock = vi.fn()
const prepareWithdrawalActionMock = vi.fn()
const resetFlowActionMock = vi.fn()
const clearAnalysisMock = vi.hoisted(() => vi.fn())
const browserListeners = new Set<() => void>()
let currentBrowser = true
vi.mock("@/lib/browser-database", () => ({
  subscribeBrowserState: (listener: () => void) => {
    browserListeners.add(listener)
    return () => browserListeners.delete(listener)
  },
  readCachedBrowserSession: () => undefined,
}))
vi.mock("@/lib/browser-session", () => ({
  captureBrowserAnalysis: async () => ({ scope: "test" }),
  clearBrowserAnalysis: clearAnalysisMock,
  readBrowserRecoveryRevision: () => 0,
  isBrowserSessionCurrent: () => currentBrowser,
}))

const authenticatedStepState = {
  stage: Stage.authenticated,
  step: RootStep.document,
}

vi.mock("@/features/llm/analysis-result-storage", () => ({
  prepareSurveySubmissionInBrowser: async (
    result: object,
    answers: object,
  ) => ({ ok: true, result: { ...result, pendingSurveyAnswer: answers } }),
  invalidateAnalysisResultStorageOperations: vi.fn(),
  readAnalysisResultFromBrowser: readResultInStorageMock,
  saveAnalysisResultInBrowser: saveResultInStorageMock,
}))

vi.mock("@/features/app-context/actions-step-state", () => ({
  cancelAnalysisAction: cancelAnalysisActionMock,
  recoverUnavailableAnalysisAction: recoverUnavailableAnalysisActionMock,
  correctConsentEmailAction: correctConsentEmailActionMock,
  completeSurveySubmissionAction: completeSurveySubmissionActionMock,
  completeWithdrawalAction: completeWithdrawalActionMock,
  prepareWithdrawalAction: prepareWithdrawalActionMock,
  confirmAuthenticationAndPrepareAnalysisAction:
    confirmAuthenticationAndPrepareAnalysisActionMock,
  failAnalysisAction: failAnalysisActionMock,
  moveToConsentAction: moveToConsentActionMock,
  moveToExplanationAction: moveToExplanationActionMock,
  prepareNewAnalysisAction: prepareNewAnalysisActionMock,
  resetFlowAction: resetFlowActionMock,
  returnToResultAction: returnToResultActionMock,
  sendConsentEmailAndMoveToAuthAction: sendConsentEmailAndMoveToAuthActionMock,
  startAnalysisAction: startAnalysisActionMock,
  startSurveyAction: startSurveyActionMock,
}))

describe("AppContextProvider", () => {
  let container: HTMLDivElement
  let context: ReturnType<typeof useAppContext>

  async function mountContext(
    initialStepState: StepState = authenticatedStepState,
  ) {
    const { AppContextProvider, useAppContext } = await import(
      "./app-context-provider"
    )
    function Probe() {
      context = useAppContext()
      return null
    }
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <AppContextProvider initialStepState={initialStepState}>
          <Probe />
        </AppContextProvider>,
      ),
    )
    return root
  }

  beforeEach(() => {
    currentBrowser = true
    clearAnalysisMock.mockReset().mockResolvedValue(true)
    activateTabOperations("synthetic")
    setTabToken("")
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    window.sessionStorage.clear()
    readResultInStorageMock.mockReset()
    saveResultInStorageMock.mockReset()
    moveToExplanationActionMock.mockReset()
    moveToConsentActionMock.mockReset()
    sendConsentEmailAndMoveToAuthActionMock.mockReset()
    confirmAuthenticationAndPrepareAnalysisActionMock.mockReset()
    prepareNewAnalysisActionMock.mockReset()
    startAnalysisActionMock.mockReset()
    failAnalysisActionMock.mockReset()
    cancelAnalysisActionMock.mockReset()
    recoverUnavailableAnalysisActionMock.mockReset()
    startSurveyActionMock.mockReset()
    returnToResultActionMock.mockReset()
    completeSurveySubmissionActionMock.mockReset()
    completeWithdrawalActionMock.mockReset()
    prepareWithdrawalActionMock.mockReset().mockResolvedValue({ ok: true })
    resetFlowActionMock.mockReset()
    correctConsentEmailActionMock.mockReset().mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
    })
    readResultInStorageMock.mockResolvedValue({ ok: true, result: null })
    saveResultInStorageMock.mockResolvedValue({ ok: true })
    moveToExplanationActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.unauthenticated, step: RootStep.explanation },
    })
    moveToConsentActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
    })
    sendConsentEmailAndMoveToAuthActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.confirmationSent, step: RootStep.auth },
    })
    confirmAuthenticationAndPrepareAnalysisActionMock.mockResolvedValue({
      ok: false,
      reason: "not_verified",
    })
    prepareNewAnalysisActionMock.mockResolvedValue({
      ok: true,
      stepState: authenticatedStepState,
    })
    startAnalysisActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.authenticated, step: RootStep.result },
    })
    failAnalysisActionMock.mockResolvedValue({
      ok: true,
      stepState: authenticatedStepState,
    })
    cancelAnalysisActionMock.mockResolvedValue({
      ok: true,
      stepState: authenticatedStepState,
    })
    startSurveyActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.authenticated, step: RootStep.survey },
    })
    returnToResultActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.authenticated, step: RootStep.result },
    })
    completeSurveySubmissionActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.followUp, step: RootStep.thanks },
    })
    completeWithdrawalActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.withdrawn, step: RootStep.withdrawn },
    })
    resetFlowActionMock.mockResolvedValue({
      ok: true,
      stepState: { stage: Stage.unauthenticated, step: RootStep.start },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ""
  })

  it.each([false, undefined, null, "false", 1, {}, []].map((ok) => ({ ok })))(
    "keeps the current screen when a transition has no confirmed success ($ok)",
    async ({ ok }) => {
      const initial = { stage: Stage.unauthenticated, step: RootStep.consent }
      const root = await mountContext(initial)
      sendConsentEmailAndMoveToAuthActionMock.mockResolvedValue({
        ok,
        reason: "send_failed",
        stepState: { stage: Stage.confirmationSent, step: RootStep.auth },
      })
      try {
        await act(async () => {
          expect(
            await context.completeConsent(
              "user@example.com",
              "prepared-context",
            ),
          ).toEqual({
            ok: false,
            reason: "send_failed",
          })
        })
        expect(context.stage).toBe(initial.stage)
        expect(context.rootStep).toBe(initial.step)
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it("rejects use outside its provider instead of reporting successful actions", async () => {
    const { useAppContext } = await import("./app-context-provider")
    function Probe() {
      useAppContext()
      return null
    }
    const root = createRoot(container)
    await expect(act(async () => root.render(<Probe />))).rejects.toThrow(
      "useAppContext requires AppContextProvider",
    )
    await act(async () => root.unmount())
  })

  it.each(["consent", "reset", "clear"])(
    "retains an in-memory consent draft across remounts and failures until %s succeeds",
    async (completion) => {
      const { AppContextProvider, useAppContext } = await import(
        "./app-context-provider"
      )
      let context: ReturnType<typeof useAppContext>
      function Probe() {
        context = useAppContext()
        return <input readOnly value={context.consentDraft.email} />
      }
      const root = createRoot(container)
      const renderRoute = (visible: boolean) =>
        root.render(
          <AppContextProvider
            initialStepState={{
              stage: Stage.unauthenticated,
              step: RootStep.consent,
            }}
          >
            {visible ? <Probe /> : <div>License page</div>}
          </AppContextProvider>,
        )
      await act(async () => renderRoute(true))
      const draft = {
        email: "synthetic@example.com",
        checks: { ...EMPTY_CONSENT_DRAFT.checks, understoodRisk: true },
      }
      await act(async () => context.updateConsentDraft(draft))
      await act(async () => renderRoute(false))
      await act(async () => renderRoute(true))
      expect(container.querySelector("input")?.value).toBe(draft.email)
      await act(async () => expect(context.consentDraft).toEqual(draft))

      sendConsentEmailAndMoveToAuthActionMock.mockResolvedValueOnce({
        ok: false,
        reason: "send_failed",
      })
      resetFlowActionMock.mockResolvedValueOnce({
        ok: false,
        reason: "session_busy",
      })
      await act(async () => {
        expect(await context.completeConsent(draft.email)).toEqual({
          ok: false,
          reason: "send_failed",
        })
        expect(await context.resetToStart()).toEqual({
          ok: false,
          reason: "session_busy",
        })
      })
      await act(async () => expect(context.consentDraft).toEqual(draft))
      expect(window.localStorage.length).toBe(0)
      expect(window.sessionStorage.length).toBe(0)

      sendConsentEmailAndMoveToAuthActionMock.mockResolvedValueOnce({
        ok: true,
        stepState: { stage: Stage.confirmationSent, step: RootStep.auth },
      })
      await act(async () => {
        if (completion === "consent") await context.completeConsent(draft.email)
        if (completion === "reset") await context.resetToStart()
        if (completion === "clear") context.clearClientState()
      })
      await act(async () =>
        expect(context.consentDraft).toEqual(EMPTY_CONSENT_DRAFT),
      )
      await act(async () => root.unmount())
    },
  )

  it("retains document edits across route remounts without replaying an old analysis job", async () => {
    const { AppContextProvider, useAppContext } = await import(
      "./app-context-provider"
    )
    const { useDocumentEditor } = await import(
      "@/features/document/use-document-editor"
    )
    let context: ReturnType<typeof useAppContext>
    let editor: ReturnType<typeof useDocumentEditor>
    function Editor() {
      editor = useDocumentEditor()
      return null
    }
    function Probe({ visible }: { visible: boolean }) {
      context = useAppContext()
      return visible && context.rootStep === RootStep.document ? (
        <Editor />
      ) : null
    }
    const root = createRoot(container)
    const renderRoute = (visible: boolean) =>
      root.render(
        <AppContextProvider initialStepState={authenticatedStepState}>
          <Probe visible={visible} />
        </AppContextProvider>,
      )
    await act(async () => renderRoute(true))
    await act(async () => {
      editor.updateDocument("document-1", "Synthetic original")
      editor.updateDocumentName("document-1", "Protocol")
      editor.addDocument()
    })
    const file = new File([""], "attachment.txt", { type: "text/plain" })
    vi.spyOn(file, "text").mockResolvedValue("Synthetic attachment")
    await act(async () => editor.handleFiles("document-2", [file]))
    await act(async () => renderRoute(false))
    await act(async () => renderRoute(true))
    await act(async () => {
      expect(editor.documents).toEqual({
        "document-1": "Synthetic original",
        "document-2": "Synthetic attachment",
      })
      expect(editor.documentNames).toEqual({
        "document-1": "Protocol",
        "document-2": "attachment.txt",
      })
      expect(editor.activeDocumentKey).toBe("document-2")
      expect(editor.sourceFileNames["document-2"]).toBe("attachment.txt")
      expect(window.localStorage.length).toBe(0)
      expect(window.sessionStorage.length).toBe(0)
      await context.startAnalysis({
        jobId: "synthetic-draft-analysis",
        documents: editor.documents,
        documentNames: editor.documentNames,
      })
    })
    await act(async () =>
      expect(context.documentDraft.documents["document-1"]).toBe(
        "Synthetic original",
      ),
    )
    await act(async () => context.failAnalysis())
    await act(async () => {
      expect(editor.documents["document-1"]).toBe("Synthetic original")
      editor.updateDocument("document-1", "Corrected after failure")
      editor.updateDocumentName("document-1", "Corrected protocol")
    })
    await act(async () => renderRoute(false))
    await act(async () => renderRoute(true))
    await act(async () => {
      expect(editor.documents["document-1"]).toBe("Corrected after failure")
      expect(editor.documentNames["document-1"]).toBe("Corrected protocol")
      editor.addDocument()
    })
    await act(async () => {
      expect(editor.documentKeys).toEqual([
        "document-1",
        "document-2",
        "document-3",
      ])
      context.clearClientState()
      context.updateDocumentDraft((draft) => ({
        ...draft,
        documents: { "document-1": "Late stale edit" },
      }))
    })
    await act(async () =>
      expect(context.documentDraft).toEqual(EMPTY_DOCUMENT_DRAFT),
    )
    await act(async () => root.unmount())
  })

  it("submits a flow intent even when another tab has a browser lock", async () => {
    const root = await mountContext()
    const request = vi.fn().mockRejectedValue(new Error("Unused browser lock"))
    vi.stubGlobal("navigator", { locks: { request } })
    await act(async () =>
      expect(await context.moveToExplanation()).toEqual({ ok: true }),
    )
    expect(moveToExplanationActionMock).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it("hydrates shared and home flow state from storage", async () => {
    await mountContext()
    expect(context).toMatchObject({
      stage: Stage.authenticated,
      rootStep: RootStep.document,
      analysisJob: null,
    })
    expect(context.surveyAnswer).toEqual({})
  })

  it.each(["withdrawal", "authentication", "flow-reset", "deletion"] as const)(
    "ignores a late %s response after force reset in another tab",
    async (intent) => {
      setTabToken(`11111111-1111-1111-1111-111111111111:${"a".repeat(64)}`)
      const root = await mountContext()
      const pending = Promise.withResolvers<unknown>()
      const actions = {
        withdrawal: {
          mock: completeWithdrawalActionMock,
          run: () => context.completeWithdrawal("participant@example.invalid"),
        },
        authentication: {
          mock: confirmAuthenticationAndPrepareAnalysisActionMock,
          run: () => context.confirmAuthentication(),
        },
        "flow-reset": {
          mock: resetFlowActionMock,
          run: () => context.resetToStart(),
        },
        deletion: {
          mock: failAnalysisActionMock,
          run: () => context.prepareNewAnalysis(),
        },
      }
      actions[intent].mock.mockReturnValueOnce(pending.promise)
      let operation!: Promise<unknown>
      await act(async () => {
        operation = actions[intent].run()
      })
      await act(async () => {
        currentBrowser = false
        for (const listener of browserListeners) listener()
      })
      await act(async () => {
        pending.resolve({
          ok: true,
          stepState: { stage: Stage.withdrawn, step: RootStep.withdrawn },
        })
        expect(await operation).toEqual({
          ok: false,
          reason: "superseded_operation",
        })
      })
      expect(saveResultInStorageMock).not.toHaveBeenCalled()
      expect(context.stage).toBe(Stage.unauthenticated)
      expect(context.result).toBeNull()
      await act(async () => root.unmount())
    },
  )

  it("returns success after a successful withdrawal", async () => {
    await mountContext()
    await act(async () => {
      expect(
        await context.completeWithdrawal("user@example.com"),
      ).toMatchObject({ ok: true })
    })
    expect(completeWithdrawalActionMock).toHaveBeenCalledWith(
      "user@example.com",
      undefined,
    )
    expect(clearAnalysisMock).toHaveBeenCalledOnce()
    expect(context.stage).toBe(Stage.withdrawn)
    expect(context.withdrawalCleanupStatus).toBe("complete")
  })

  it.each([
    {
      flags: { withdrawalCleanupPending: true },
      cleared: true,
      status: "pending",
    },
    {
      flags: { withdrawalStateWriteFailed: true },
      cleared: true,
      status: "stateFailed",
    },
    { flags: {}, cleared: false, status: "localFailed" },
    ...[undefined, null, "false", 1, {}, []].map((cleared) => ({
      flags: {},
      cleared,
      status: "localFailed",
    })),
  ])(
    "does not claim cleanup completion for $status",
    async ({ flags, cleared, status }) => {
      completeWithdrawalActionMock.mockResolvedValue({
        ok: true,
        stepState: { stage: Stage.withdrawn, step: RootStep.withdrawn },
        ...flags,
      })
      await mountContext()
      clearAnalysisMock.mockResolvedValue(cleared)
      await act(async () => {
        await context.completeWithdrawal("user@example.com")
      })
      expect(context.withdrawalCleanupStatus).toBe(status)
    },
  )

  it("does not infer cleanup completion from a restored withdrawn stage", async () => {
    await mountContext({ stage: Stage.withdrawn, step: RootStep.withdrawn })
    expect(context.withdrawalCleanupStatus).toBe("unconfirmed")
  })

  it("confirms authentication by adopting the server-prepared analysis state", async () => {
    confirmAuthenticationAndPrepareAnalysisActionMock.mockResolvedValue({
      ok: true,
      stepState: authenticatedStepState,
    })
    await mountContext({ stage: Stage.confirmationSent, step: RootStep.auth })
    await act(async () => {
      expect(await context.confirmAuthentication()).toEqual({ ok: true })
    })
    expect(
      confirmAuthenticationAndPrepareAnalysisActionMock,
    ).toHaveBeenCalledOnce()
    expect(context.stepState).toEqual(authenticatedStepState)
    expect(clearAnalysisMock).toHaveBeenCalledOnce()
  })

  it.each([Stage.authenticated, Stage.followUp])(
    "adopts the server's %s stage when preparing a new analysis",
    async (stage) => {
      const transition =
        stage === Stage.followUp
          ? prepareNewAnalysisActionMock
          : failAnalysisActionMock
      transition.mockResolvedValue({
        ok: true,
        stepState: { stage, step: RootStep.document },
      })
      await mountContext({
        stage,
        step: stage === Stage.followUp ? RootStep.thanks : RootStep.result,
      })
      await act(async () => {
        expect(await context.prepareNewAnalysis()).toEqual({
          ok: true,
          resultCleared: true,
        })
      })
      expect(transition).toHaveBeenCalledOnce()
      if (stage === Stage.followUp) {
        expect(prepareNewAnalysisActionMock).toHaveBeenCalledWith(
          null,
          undefined,
        )
        expect(failAnalysisActionMock).not.toHaveBeenCalled()
      }
      expect(context.stepState).toEqual({ stage, step: RootStep.document })
      expect(clearAnalysisMock).toHaveBeenCalledOnce()
    },
  )

  it("moves from start to explanation by saving the normalized step state", async () => {
    await mountContext({ stage: Stage.unauthenticated, step: RootStep.start })
    await act(async () => {
      expect(await context.moveToExplanation()).toEqual({ ok: true })
    })
    expect(moveToExplanationActionMock).toHaveBeenCalledOnce()
    expect(context.rootStep).toBe(RootStep.explanation)
  })

  it("starts analysis with a new job and clears stale in-memory results", async () => {
    const sampleResult: AnalysisResult = {
      analysisId: "analysis-1",
      analysisWorkspaceVersion: "1.0.0",
      modelName: "gpt-test",
      processingDurationSeconds: 1,
      documentCount: 1,
      documentGraphemeCount: 10,
      resultGraphemeCount: 20,
      text: "解析結果",
    }
    readResultInStorageMock.mockResolvedValueOnce({
      ok: true,
      result: sampleResult,
    })

    const { AppContextProvider, useAppContext } = await import(
      "./app-context-provider"
    )

    function Probe() {
      const { analysisJob, result, rootStep, startAnalysis } = useAppContext()

      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void startAnalysis({
                jobId: "request-1",
                documents: { "0-application": "doc" },
              })
            }
          >
            start
          </button>
          <div>{rootStep}</div>
          <div>{analysisJob?.jobId ?? "none"}</div>
          <div>{result?.text ?? "no-result"}</div>
        </div>
      )
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContextProvider initialStepState={authenticatedStepState}>
          <Probe />
        </AppContextProvider>,
      )
    })

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain(RootStep.result)
    expect(container.textContent).toContain("request-1")
    expect(container.textContent).toContain("no-result")
    expect(saveResultInStorageMock).not.toHaveBeenCalled()
  })

  it.each(["missing", "unavailable", "rejected"])(
    "keeps hydration read-only when the stored result is %s",
    async (outcome) => {
      if (outcome === "unavailable")
        readResultInStorageMock.mockResolvedValueOnce({ ok: false })
      if (outcome === "rejected")
        readResultInStorageMock.mockRejectedValueOnce(new Error("offline"))
      const { AppContextProvider, useAppContext } = await import(
        "./app-context-provider"
      )
      let context: ReturnType<typeof useAppContext> | undefined
      function Probe() {
        context = useAppContext()
        return null
      }
      const root = createRoot(container)
      await act(async () =>
        root.render(
          <AppContextProvider
            initialStepState={{
              stage: Stage.authenticated,
              step: RootStep.result,
            }}
          >
            <Probe />
          </AppContextProvider>,
        ),
      )
      expect(context?.rootStep).toBe(RootStep.result)
      expect(context?.isRestoringResult).toBe(false)
      expect(context?.resultRestorationFailed).toBe(outcome !== "missing")
      expect(failAnalysisActionMock).not.toHaveBeenCalled()
      expect(resetFlowActionMock).not.toHaveBeenCalled()
      expect(saveResultInStorageMock).not.toHaveBeenCalled()
      await act(async () => root.unmount())
    },
  )

  it("keeps missing-result recovery available as an explicit intent", async () => {
    const { AppContextProvider, useAppContext } = await import(
      "./app-context-provider"
    )
    let context: ReturnType<typeof useAppContext> | undefined
    function Probe() {
      context = useAppContext()
      return null
    }
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <AppContextProvider
          initialStepState={{
            stage: Stage.authenticated,
            step: RootStep.result,
          }}
        >
          <Probe />
        </AppContextProvider>,
      ),
    )
    expect(prepareNewAnalysisActionMock).not.toHaveBeenCalled()
    await act(async () => {
      await expect(context?.prepareNewAnalysis()).resolves.toEqual({
        ok: true,
        resultCleared: true,
      })
    })
    expect(failAnalysisActionMock).toHaveBeenCalledTimes(1)
    expect(context?.rootStep).toBe(RootStep.document)
    await act(async () => root.unmount())
  })

  it("does not rerun storage hydration when the step state changes", async () => {
    readResultInStorageMock.mockResolvedValueOnce({
      ok: true,
      result: {
        analysisId: "analysis-a",
        analysisWorkspaceVersion: "1.0.0",
        modelName: "local",
        text: "result",
        processingDurationSeconds: 1,
        documentCount: 1,
        documentGraphemeCount: 1,
        resultGraphemeCount: 1,
      },
    })
    const { AppContextProvider, useAppContext } = await import(
      "./app-context-provider"
    )

    function Probe() {
      const { completeSurveySubmission, rootStep } = useAppContext()

      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void completeSurveySubmission({}, initialDefinitionId)
            }
          >
            complete
          </button>
          <div>{rootStep}</div>
        </div>
      )
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContextProvider initialStepState={authenticatedStepState}>
          <Probe />
        </AppContextProvider>,
      )
    })

    await act(async () => {
      container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain(RootStep.thanks)

    await act(async () => {
      root.render(
        <AppContextProvider initialStepState={authenticatedStepState}>
          <Probe />
        </AppContextProvider>,
      )
    })

    expect(container.textContent).toContain(RootStep.thanks)
    expect(readResultInStorageMock).toHaveBeenCalledTimes(1)
  })

  it("ignores changed server-provided initial step state after initialization", async () => {
    const { AppContextProvider, useAppContext } = await import(
      "./app-context-provider"
    )

    function Probe() {
      const { rootStep, stage } = useAppContext()
      return <div>{`${stage}:${rootStep}`}</div>
    }

    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContextProvider
          initialStepState={{
            stage: Stage.unauthenticated,
            step: RootStep.start,
          }}
        >
          <Probe />
        </AppContextProvider>,
      )
    })

    expect(container.textContent).toContain("unauthenticated:start")

    await act(async () => {
      root.render(
        <AppContextProvider
          initialStepState={{
            stage: Stage.confirmationSent,
            step: RootStep.auth,
          }}
        >
          <Probe />
        </AppContextProvider>,
      )
    })

    expect(container.textContent).toContain("unauthenticated:start")
  })
  it.each(["reset", "withdraw", "new-analysis", "abort"])(
    "rejects a pending completion after %s",
    async (operation) => {
      const root = await mountContext()
      let finish!: (saved: AnalysisResultWriteOutcome) => void
      saveResultInStorageMock.mockImplementationOnce(
        () =>
          new Promise<AnalysisResultWriteOutcome>((resolve) => {
            finish = resolve
          }),
      )
      const oldResult: AnalysisResult = {
        analysisId: "old-analysis",
        analysisWorkspaceVersion: "1.0.0",
        modelName: "local-model",
        processingDurationSeconds: 1,
        documentCount: 1,
        documentGraphemeCount: 1,
        resultGraphemeCount: 1,
        text: "old result",
      }
      const controller = new AbortController()
      let saving!: ReturnType<typeof context.completeAnalysis>
      await act(async () => {
        saving = context.completeAnalysis(oldResult, controller.signal)
      })
      await act(async () => {
        if (operation === "reset") context.clearClientState()
        if (operation === "withdraw")
          await context.completeWithdrawal("test@example.invalid")
        if (operation === "new-analysis")
          await context.startAnalysis({
            jobId: "new-job",
            documents: { one: "new document" },
          })
        if (operation === "abort") controller.abort()
      })
      await act(async () => {
        finish({ ok: true })
        expect(await saving).toEqual({ ok: false, reason: "stale_analysis" })
      })
      expect(context.result).toBeNull()
      if (operation === "new-analysis")
        expect(context.analysisJob?.jobId).toBe("new-job")
      await act(async () => root.unmount())
    },
  )

  it.each([false, undefined, null, "false", 1, {}, []])(
    "reports incomplete reset unless local deletion explicitly succeeds: %j",
    async (cleared) => {
      const root = await mountContext()
      resetFlowActionMock.mockResolvedValueOnce({
        ok: true,
        stepState: { stage: Stage.unauthenticated, step: RootStep.start },
      })
      clearAnalysisMock.mockResolvedValueOnce(cleared)
      try {
        await act(async () => {
          expect(await context.resetToStart()).toEqual({
            ok: false,
            reason: "result_clear_failed",
          })
        })
        expect(context.stage).toBe(Stage.unauthenticated)
        expect(context.rootStep).toBe(RootStep.start)
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it.each([false, undefined, null, "false", 1, {}, []])(
    "reports incomplete authentication cleanup unless deletion explicitly succeeds: %j",
    async (cleared) => {
      confirmAuthenticationAndPrepareAnalysisActionMock.mockResolvedValueOnce({
        ok: true,
        stepState: authenticatedStepState,
      })
      const root = await mountContext({
        stage: Stage.confirmationSent,
        step: RootStep.auth,
      })
      clearAnalysisMock.mockResolvedValueOnce(cleared)
      try {
        await act(async () => {
          expect(await context.confirmAuthentication()).toEqual({
            ok: false,
            reason: "result_clear_failed",
          })
        })
        expect(startAnalysisActionMock).not.toHaveBeenCalled()
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it("preserves state and stored results when the server reset is rejected", async () => {
    const root = await mountContext()
    resetFlowActionMock.mockResolvedValueOnce({
      ok: false,
      reason: "step_state_write_failed",
    })
    await act(async () => {
      expect(await context.resetToStart()).toEqual({
        ok: false,
        reason: "step_state_write_failed",
      })
    })
    expect(context.rootStep).toBe(RootStep.document)
    expect(context.stage).toBe(Stage.authenticated)
    expect(saveResultInStorageMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it("ignores hydration that completes after reset", async () => {
    let finish!: (value: AnalysisResultReadOutcome) => void
    readResultInStorageMock.mockReturnValueOnce(
      new Promise<AnalysisResultReadOutcome>((resolve) => {
        finish = resolve
      }),
    )
    const root = await mountContext()
    await act(async () => context.clearClientState())
    await act(async () =>
      finish({
        ok: true,
        result: {
          analysisId: "old",
          analysisWorkspaceVersion: "1.0.0",
          modelName: "local",
          processingDurationSeconds: 1,
          documentCount: 1,
          documentGraphemeCount: 1,
          resultGraphemeCount: 1,
          text: "old result",
        },
      }),
    )
    expect(context.result).toBeNull()
    expect(context.rootStep).toBe(RootStep.start)
    await act(async () => root.unmount())
  })

  it.each(["storage_changed"] as const)(
    "stops completion without resetting another tab after %s",
    async (reason) => {
      const root = await mountContext()
      await act(async () => {
        await context?.startAnalysis({
          jobId: "old",
          documents: { doc: "synthetic" },
        })
      })
      saveResultInStorageMock.mockResolvedValueOnce({ ok: false, reason })
      await act(async () => {
        await expect(
          context?.completeAnalysis({
            analysisId: "old",
            analysisWorkspaceVersion: "1.0.0",
            modelName: "local",
            processingDurationSeconds: 1,
            documentCount: 1,
            documentGraphemeCount: 1,
            resultGraphemeCount: 1,
            text: "synthetic",
          }),
        ).resolves.toEqual({ ok: false, reason })
      })
      expect(context?.analysisJob).toBeNull()
      expect(context?.result).toBeNull()
      expect(failAnalysisActionMock).not.toHaveBeenCalled()
      expect(resetFlowActionMock).not.toHaveBeenCalled()
      await act(async () => root.unmount())
    },
  )

  it.each(
    [true, false, undefined, null, "false", 1, {}, []].map((stored) => ({
      stored,
    })),
  )(
    "retains retry documents unless result storage confirms true (stored=$stored)",
    async ({ stored }) => {
      const { recordResultPresentationAction } = await import(
        "@/features/llm/actions-record-presentation"
      )
      vi.mocked(recordResultPresentationAction).mockClear()
      await mountContext()
      const job = {
        jobId: "retry-job",
        documents: { "document-1": "manually edited research plan" },
        documentNames: { "document-1": "Research plan" },
      }
      const result: AnalysisResult = {
        analysisId: "analysis-1",
        analysisWorkspaceVersion: "1.0.0",
        modelName: "local-model",
        processingDurationSeconds: 1,
        documentCount: 1,
        documentGraphemeCount: 1,
        resultGraphemeCount: 1,
        text: "result",
      }
      await act(async () => {
        await context.startAnalysis(job)
      })
      saveResultInStorageMock.mockResolvedValueOnce({
        ok: stored,
        reason: "write_failed",
      } as AnalysisResultWriteOutcome)
      await act(async () => {
        expect(await context.completeAnalysis(result)).toEqual({
          ok: true,
          resultStored: stored === true,
        })
        if (stored !== true) await context.failAnalysis()
      })
      if (stored === true) {
        expect(recordResultPresentationAction).toHaveBeenCalledOnce()
        expect(context.analysisJob).toBeNull()
        expect(context.result).toEqual(result)
      } else {
        expect(recordResultPresentationAction).not.toHaveBeenCalled()
        expect(context.rootStep).toBe(RootStep.document)
        expect(context.analysisJob).toEqual(job)
        expect(context.result).toBeNull()
      }
    },
  )
  it.each(["stalled", "rejected"])(
    "exposes stored output after presentation even when RAM acknowledgement is %s",
    async (outcome) => {
      const { acknowledgeAnalysisResult } = await import(
        "@/features/llm/analysis-job-client"
      )
      vi.mocked(acknowledgeAnalysisResult).mockImplementationOnce(() =>
        outcome === "stalled"
          ? new Promise(() => {})
          : Promise.reject(new Error("network")),
      )
      const root = await mountContext()
      const result: AnalysisResult = {
        analysisId: "analysis-1",
        analysisWorkspaceVersion: "1.0.0",
        modelName: "local",
        processingDurationSeconds: 1,
        documentCount: 1,
        documentGraphemeCount: 1,
        resultGraphemeCount: 1,
        text: "synthetic",
      }
      await act(async () => {
        await expect(context.completeAnalysis(result)).resolves.toEqual({
          ok: true,
          resultStored: true,
        })
      })
      expect(context.result).toEqual(result)
      await act(async () => root.unmount())
    },
  )

  it("does not expose or acknowledge output before Firestore presentation succeeds", async () => {
    const { recordResultPresentationAction } = await import(
      "@/features/llm/actions-record-presentation"
    )
    const { acknowledgeAnalysisResult } = await import(
      "@/features/llm/analysis-job-client"
    )
    vi.mocked(acknowledgeAnalysisResult).mockClear()
    vi.mocked(recordResultPresentationAction).mockResolvedValueOnce({
      ok: false,
      reason: "presentation_failed",
    })
    const root = await mountContext()
    await act(async () => {
      await expect(
        context.completeAnalysis({
          analysisId: "analysis-1",
          analysisWorkspaceVersion: "1.0.0",
          modelName: "local",
          processingDurationSeconds: 1,
          documentCount: 1,
          documentGraphemeCount: 1,
          resultGraphemeCount: 1,
          text: "synthetic",
        }),
      ).resolves.toEqual({ ok: true, resultStored: false })
    })
    expect(context.result).toBeNull()
    expect(acknowledgeAnalysisResult).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it.each([Stage.authenticated, Stage.followUp])(
    "adopts approved unavailable-result recovery while retaining the document draft (%s)",
    async (stage) => {
      const root = await mountContext({
        stage,
        step: RootStep.document,
      })
      startAnalysisActionMock.mockResolvedValueOnce({
        ok: true,
        stepState: { stage, step: RootStep.result },
      })
      recoverUnavailableAnalysisActionMock.mockResolvedValueOnce({
        ok: true,
        stepState: { stage, step: RootStep.document },
      })
      await act(async () => {
        context.updateDocumentDraft((draft) => ({
          ...draft,
          documents: { a: "synthetic draft" },
        }))
        await context.startAnalysis({
          jobId: "job",
          documents: { a: "synthetic draft" },
        })
      })
      await act(async () => {
        expect(
          (await context.recoverUnavailableAnalysis("analysis-1")).ok,
        ).toBe(true)
      })
      expect(context.rootStep).toBe(RootStep.document)
      expect(context.documentDraft.documents.a).toBe("synthetic draft")
      expect(context.analysisJob).toBeNull()
      expect(context.result).toBeNull()
      expect(clearAnalysisMock).toHaveBeenCalledOnce()
      await act(async () => root.unmount())
    },
  )
})

vi.mock("@/features/session/use-session-admission", () => ({
  useSessionAdmission: () => ({
    status: "ready",
    initialStep: null,
  }),
}))

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))

vi.mock("@/features/llm/actions-record-presentation", () => ({
  recordResultPresentationAction: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/features/llm/analysis-job-client", () => ({
  acknowledgeAnalysisResult: vi.fn(async () => {}),
}))
