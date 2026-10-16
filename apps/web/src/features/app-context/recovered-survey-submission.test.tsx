/** @vitest-environment jsdom */
import { IDBObjectStore } from "fake-indexeddb"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as recoveredStorage from "@/features/survey/survey-recovery-storage"
import { getBrowserSession, readBrowserPayload } from "@/lib/browser-session"
import { activateTabOperations } from "@/lib/tab-cancellation"
import { setTabToken } from "@/lib/tab-token"
import { initialDefinitionId } from "../../../test-support/questionnaires"
import { AppContextProvider, useAppContext } from "./app-context-provider"
import { RootStep } from "./root-step-types"
import { Stage } from "./stage-types"

const { submit, confirm, prepare } = vi.hoisted(() => ({
  submit: vi.fn(),
  confirm: vi.fn(),
  prepare: vi.fn(),
}))
vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("@/features/session/use-session-admission", () => ({
  useSessionAdmission: () => ({ status: "ready", initialStep: null }),
}))
vi.mock("@/features/app-context/actions-step-state", () => ({
  confirmAuthenticationAndPrepareAnalysisAction: confirm,
  completeSurveySubmissionAction: submit,
  prepareNewAnalysisAction: prepare,
  startAnalysisAction: async () => ({
    ok: true,
    stepState: { stage: "follow_up", step: "result" },
  }),
  startSurveyAction: async () => ({
    ok: true,
    stepState: { stage: "follow_up", step: "survey" },
  }),
}))
vi.mock("@/features/llm/actions-analysis-result-seal", () => ({
  sealAnalysisResultAction: async (result: unknown) => JSON.stringify(result),
  unsealAnalysisResultAction: async (value: string) => ({
    ok: true,
    result: JSON.parse(value),
  }),
}))
vi.mock("@/features/survey/actions-survey-recovery-seal", () => ({
  sealRecoveredSurveyDraftAction: async (draft: unknown) => ({
    ok: true,
    sealed: JSON.stringify(draft),
  }),
  unsealRecoveredSurveyDraftAction: async (value: string) => ({
    ok: true,
    draft: JSON.parse(value),
  }),
}))
vi.mock("@/features/llm/actions-record-presentation", () => ({
  recordResultPresentationAction: async () => ({ ok: true }),
}))
vi.mock("@/features/llm/analysis-job-client", () => ({
  acknowledgeAnalysisResult: async () => {},
}))
const accepted = {
  ok: true,
  stepState: { stage: Stage.followUp, step: RootStep.thanks },
}
const answers = { q1: "synthetic answer" }
let root: Root
let context: ReturnType<typeof useAppContext>
function Probe() {
  context = useAppContext()
  return null
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.restoreAllMocks()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  await getBrowserSession()
  activateTabOperations("synthetic")
  setTabToken("")
  confirm.mockResolvedValue({
    ok: true,
    recoveredSurveyAnalysisId: "recovered-analysis",
    stepState: { stage: Stage.authenticated, step: RootStep.survey },
  })
  prepare.mockResolvedValue({
    ok: true,
    stepState: { stage: Stage.followUp, step: RootStep.document },
  })
  submit.mockReset().mockResolvedValue(accepted)
  root = createRoot(document.createElement("div"))
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
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(context.isRestoringResult).toBe(false)
  })
  await act(async () => {
    expect((await context.confirmAuthentication()).ok).toBe(true)
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.restoreAllMocks()
})

async function prepareNextQuestionnaire() {
  await act(async () => {
    expect(await context.prepareNewAnalysis()).toEqual({
      ok: true,
      resultCleared: true,
    })
  })
  await act(async () => {
    expect(
      (
        await context.startAnalysis({
          jobId: "next",
          documents: { doc: "synthetic" },
        })
      ).ok,
    ).toBe(true)
  })
  await act(async () => {
    expect(
      (
        await context.completeAnalysis({
          analysisId: "next-analysis",
          analysisWorkspaceVersion: "1.0.0",
          modelName: "synthetic",
          processingDurationSeconds: 1,
          documentCount: 1,
          documentGraphemeCount: 1,
          resultGraphemeCount: 1,
          text: "synthetic",
        })
      ).ok,
    ).toBe(true)
  })
  await act(async () => {
    expect((await context.startSurvey()).ok).toBe(true)
  })
  await act(async () => context.updateSurveyAnswer("newQuestion", "new answer"))
}

it("keeps acceptance after a cleanup transaction abort and permits new answers after explicit cleanup", async () => {
  submit.mockImplementationOnce(async () => {
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = original.apply(this, args)
      request.addEventListener("success", () => this.transaction.abort())
      return request
    })
    return accepted
  })
  await act(async () => {
    expect(
      await context.completeSurveySubmission(answers, initialDefinitionId),
    ).toEqual({ ok: true, localCleanupFailed: true })
  })
  expect(context.rootStep).toBe(RootStep.thanks)
  expect(context.recoveredSurveyPending).toBe(false)
  expect(context.surveyAnswer).toEqual({})
  expect((await readBrowserPayload("recoveredSurvey")).value).not.toBeNull()
  await prepareNextQuestionnaire()
  expect(context.surveyAnswer).toEqual({ newQuestion: "new answer" })
  expect((await readBrowserPayload("recoveredSurvey")).value).toBeNull()
  expect(submit).toHaveBeenCalledOnce()
})

it("keeps unconfirmed answers frozen for exact retry instead of clearing them", async () => {
  submit.mockResolvedValueOnce({ ok: false, reason: "submit_failed" })
  await act(async () => {
    expect(
      (await context.completeSurveySubmission(answers, initialDefinitionId)).ok,
    ).toBe(false)
  })
  const stored = (await readBrowserPayload("recoveredSurvey")).value
  expect(stored).not.toBeNull()
  expect(context.recoveredSurveyPending).toBe(true)
  await act(async () => context.updateSurveyAnswer("q1", "edited"))
  expect(context.surveyAnswer).toEqual(answers)
  expect((await readBrowserPayload("recoveredSurvey")).value).toBe(stored)
  await act(async () => {
    expect(
      await context.completeSurveySubmission(
        { q1: "edited" },
        initialDefinitionId,
      ),
    ).toEqual({ ok: true })
  })
  expect(submit).toHaveBeenNthCalledWith(
    2,
    answers,
    "recovered-analysis",
    initialDefinitionId,
    undefined,
  )
  expect(context.recoveredSurveyPending).toBe(false)
})

it.each([false, undefined, null, "false", 1, {}, []])(
  "never treats an unconfirmed cleanup result as completed (%j)",
  async (cleared) => {
    vi.spyOn(
      recoveredStorage,
      "clearRecoveredSurveyDraft",
    ).mockResolvedValueOnce(cleared as boolean)
    await act(async () => {
      expect(
        await context.completeSurveySubmission(answers, initialDefinitionId),
      ).toEqual({ ok: true, localCleanupFailed: true })
    })
    expect(context.rootStep).toBe(RootStep.thanks)
    expect(context.recoveredSurveyPending).toBe(false)
  },
)

it("ignores a delayed cleanup outcome after the user starts the next questionnaire", async () => {
  const cleanup = Promise.withResolvers<boolean>()
  const clearing = vi
    .spyOn(recoveredStorage, "clearRecoveredSurveyDraft")
    .mockReturnValueOnce(cleanup.promise)
  let completion!: ReturnType<typeof context.completeSurveySubmission>
  await act(async () => {
    completion = context.completeSurveySubmission(answers, initialDefinitionId)
  })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(clearing).toHaveBeenCalledOnce()
  })
  await prepareNextQuestionnaire()
  await act(async () => {
    cleanup.resolve(false)
    expect(await completion).toEqual({
      ok: false,
      reason: "superseded_operation",
    })
  })
  expect(context.rootStep).toBe(RootStep.survey)
  expect(context.surveyAnswer).toEqual({ newQuestion: "new answer" })
  expect(context.result?.analysisId).toBe("next-analysis")
})
