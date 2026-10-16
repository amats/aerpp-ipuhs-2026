/** @vitest-environment jsdom */

import { IDBObjectStore } from "fake-indexeddb"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import SectionResult from "@/features/home-flow/section-result"
import { createPseudonym } from "@/features/identity/participant-identifiers"
import SectionSurvey from "@/features/survey/section-survey"
import { surveyQuestionSets } from "@/features/survey/survey-question-sets"
import {
  activateTabOperations,
  getTabOperationSignal,
} from "@/lib/tab-cancellation"
import {
  readStoredResult,
  writeStoredResult,
} from "../../../test-support/browser-state"
import { initialDefinitionId } from "../../../test-support/questionnaires"
import type {
  AnalysisResult,
  AnalysisResultReadOutcome,
} from "./analysis-result-types"
import { AppContextProvider, useAppContext } from "./app-context-provider"
import { RootStep } from "./root-step-types"
import { Stage } from "./stage-types"

const ANALYSIS_ID_A = `aerpp:aid-${"a".repeat(32)}`
const ANALYSIS_ID_B = `aerpp:aid-${"b".repeat(32)}`
const {
  sealSurveyMock,
  decryptMock,
  encryptMock,
  backendMock,
  getSessionMock,
  updateStatusMock,
  startJobMock,
  finalizeMock,
} = vi.hoisted(() => ({
  sealSurveyMock: vi.fn(),
  startJobMock: vi.fn(),
  finalizeMock: vi.fn(),
  updateStatusMock: vi.fn(),
  decryptMock: vi.fn(),
  encryptMock: vi.fn(),
  backendMock: vi.fn(),
  getSessionMock: vi.fn(),
}))
const session = {
  consentId: "test-consent",
  submittedAnalysisId: undefined as string | undefined,
  pendingSurveyAnalysisId: undefined as string | undefined,
  stage: Stage.authenticated as Stage,
  questionnaireKind: "initial" as "initial" | "follow-up",
  rootStep: RootStep.result as RootStep,
  lastCompletedAnalysisId: ANALYSIS_ID_A as string | undefined,
  clientId: `aerpp:cid-${"c".repeat(32)}`,
  email: "user@example.com",
  pseudonym: createPseudonym("user@example.com"),
  authVerifiedAt: "2026-09-01T00:00:00.000Z",
  save: vi.fn(async () => {}),
}

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({ updateStatusMessage: updateStatusMock }),
}))
vi.mock("@/features/llm/analysis-job-client", () => ({
  acknowledgeAnalysisResult: vi.fn(async () => {}),
  requestAnalysisJob: async (args: {
    documents?: unknown
    analysisId?: string
  }) =>
    args.documents
      ? startJobMock(args)
      : args.analysisId
        ? {
            ok: true,
            analysisId: ANALYSIS_ID_A,
            text: batchText,
            receipt: "test-receipt",
          }
        : {
            ok: true,
            analysisId: null,
            status: "idle",
            startedAtMs: null,
            elapsedMs: null,
          },
  waitForAnalysisPoll: vi.fn(),
}))
vi.mock("@/features/llm/actions-finalize-analysis", () => ({
  finalizeAnalysisAction: finalizeMock,
}))
vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
  getSessionForTab: getSessionMock,
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getRequestContextFromHeaders: () => ({}),
}))
vi.mock("@/features/auth/auth-service", () => ({
  sendMagicLinkEmail: vi.fn(),
  verifyAuthentication: vi.fn(async () => ({ ok: true })),
  withdrawParticipation: vi.fn(),
}))
vi.mock("@/lib/fetch-with-retry", () => ({ fetchWithRetry: backendMock }))
vi.mock("@/features/llm/actions-analysis-result-seal", () => ({
  unsealAnalysisResultAction: decryptMock,
  sealSurveyResultAction: sealSurveyMock,
  sealAnalysisResultAction: encryptMock,
}))

let batchText = "partial output"
const resultA: AnalysisResult = {
  analysisId: ANALYSIS_ID_A,
  text: "AnalysisResult A",
  analysisWorkspaceVersion: "1.0.0",
  modelName: "local",
  documentCount: 1,
  documentGraphemeCount: 10,
  resultGraphemeCount: 10,
  processingDurationSeconds: 1,
}
let context!: ReturnType<typeof useAppContext>
let root: Root
let container: HTMLDivElement
function Probe() {
  context = useAppContext()
  return context.rootStep === RootStep.result ? (
    <SectionResult />
  ) : context.rootStep === RootStep.survey ? (
    <SectionSurvey {...surveyQuestionSets} />
  ) : null
}
async function mount(
  step: typeof RootStep.result | typeof RootStep.survey,
  waitForRestore = true,
) {
  session.questionnaireKind =
    session.stage === Stage.followUp ? "follow-up" : "initial"
  root = createRoot(container)
  await act(async () =>
    root.render(
      <AppContextProvider initialStepState={{ stage: session.stage, step }}>
        <Probe />
      </AppContextProvider>,
    ),
  )
  if (waitForRestore)
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(context.isRestoringResult).toBe(false)
    })
  else await vi.waitFor(() => expect(decryptMock).toHaveBeenCalled())
}
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {})
    check()
  })
}
function createAnswers() {
  const answers: Record<string, string> = {}
  for (const question of surveyQuestionSets.initialSurveyQuestionSet
    .questions) {
    if (!question.required || question.type === "section") continue
    answers[question.id] =
      question.type === "text" ? "feedback on A" : question.options[0]
  }
  return answers
}
beforeEach(async () => {
  activateTabOperations("synthetic")
  delete session.submittedAnalysisId
  delete session.pendingSurveyAnalysisId
  window.sessionStorage.clear()
  vi.spyOn(window, "confirm").mockReturnValue(true)

  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  sealSurveyMock.mockReset().mockImplementation(async (result) => {
    const sealedResult = await encryptMock(result)
    return sealedResult === null
      ? { ok: false, reason: "write_failed" }
      : { ok: true, sealedResult }
  })
  startJobMock.mockReset()
  encryptMock.mockReset()
  decryptMock.mockReset()
  backendMock.mockReset()
  window.scrollTo = vi.fn()
  session.authVerifiedAt = "2026-09-01T00:00:00.000Z"
  container = document.createElement("div")
  document.body.append(container)
  window.localStorage.clear()
  await writeStoredResult("encrypted-A")
  decryptMock.mockImplementation(async (value) => ({
    ok: true,
    result: value.startsWith("sealed:")
      ? JSON.parse(value.slice(7))
      : value === "encrypted-B"
        ? { ...resultA, analysisId: ANALYSIS_ID_B }
        : resultA,
  }))
  encryptMock.mockImplementation(
    async (result) => `sealed:${JSON.stringify(result)}`,
  )
  getSessionMock.mockResolvedValue(session)
  session.save.mockReset().mockResolvedValue(undefined)
  session.stage = Stage.authenticated
  session.rootStep = RootStep.result
  session.lastCompletedAnalysisId = ANALYSIS_ID_A
  backendMock.mockImplementation(async () =>
    Response.json({ ok: true, count: 0 }),
  )
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container.remove()
  vi.restoreAllMocks()
})

it.each([false, true])(
  "waits for restored survey answers before accepting input; pending submission: %s",
  async (hasPendingSubmission) => {
    const pending = Promise.withResolvers<AnalysisResultReadOutcome>()
    decryptMock.mockReturnValueOnce(pending.promise)
    session.rootStep = RootStep.survey
    await mount(RootStep.survey, false)
    const controls = Array.from(
      container.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("form input, form select, form textarea"),
    )
    expect(controls.length).toBeGreaterThan(0)
    expect(context.isRestoringResult).toBe(true)
    expect(controls.every((control) => control.matches(":disabled"))).toBe(true)
    const radio = container.querySelector<HTMLInputElement>(
      'input[type="radio"]',
    )
    await act(async () => radio?.click())
    expect(context.surveyAnswer).toEqual({})
    expect(backendMock).not.toHaveBeenCalled()
    expect(session.save).not.toHaveBeenCalled()

    const savedAnswers = createAnswers()
    await act(async () =>
      pending.resolve({
        ok: true,
        result: hasPendingSubmission
          ? {
              ...resultA,
              pendingSurveyAnswer: savedAnswers,
              pendingQuestionnaireId: initialDefinitionId,
            }
          : resultA,
      }),
    )
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(context.isRestoringResult).toBe(false)
    })
    expect(context.surveyAnswer).toEqual(
      hasPendingSubmission ? savedAnswers : {},
    )
    expect(controls.every((control) => control.matches(":disabled"))).toBe(
      hasPendingSubmission,
    )
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false)

    if (hasPendingSubmission) {
      const select = container.querySelector<HTMLSelectElement>("select")
      expect(select?.value).toBe(savedAnswers[select?.name ?? ""])
      await act(async () => radio?.click())
      expect(context.surveyAnswer).toEqual(savedAnswers)
    } else {
      await act(async () => radio?.click())
      expect(context.surveyAnswer[radio?.name ?? ""]).toBe(radio?.value)
      await act(async () => {
        expect(await context.returnToResult()).toEqual({ ok: true })
      })
      await act(async () => {
        expect(await context.startSurvey()).toEqual({ ok: true })
      })
      expect(
        container.querySelector<HTMLInputElement>(
          `input[name="${radio?.name}"][value="${radio?.value}"]`,
        )?.checked,
      ).toBe(true)
    }
  },
)

it("keeps edited answers through an actual survey-result-survey transition", async () => {
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  const select = container.querySelector("select") as HTMLSelectElement
  const radio = container.querySelector<HTMLInputElement>(
    'input[type="radio"]',
  ) as HTMLInputElement
  await act(async () => {
    select.value = select.options[1].value
    select.dispatchEvent(new Event("change", { bubbles: true }))
    radio.click()
  })
  const answers = { ...context.surveyAnswer }
  expect(answers).toEqual({
    [select.name]: select.value,
    [radio.name]: radio.value,
  })
  const back = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "結果表示に戻る",
  ) as HTMLButtonElement
  await act(async () => back.click())
  expect(context.rootStep).toBe(RootStep.result)
  expect(container.querySelector("form")).toBeNull()
  const survey = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "アンケートを開く",
  ) as HTMLButtonElement
  await act(async () => survey.click())
  expect(context.rootStep).toBe(RootStep.survey)
  expect(context.surveyAnswer).toEqual(answers)
  expect(container.querySelector("select")?.value).toBe(answers[select.name])
  expect(
    container.querySelector<HTMLInputElement>(
      `input[name="${radio.name}"][value="${radio.value}"]`,
    )?.checked,
  ).toBe(true)
  expect(backendMock).not.toHaveBeenCalled()
})

it("rejects survey entry for A after another tab completes B", async () => {
  await mount(RootStep.result)
  session.lastCompletedAnalysisId = ANALYSIS_ID_B
  await writeStoredResult("encrypted-B")
  await act(async () => {
    expect(await context.startSurvey()).toEqual({
      ok: false,
      reason: "superseded_operation",
    })
  })
  expect(getTabOperationSignal()?.aborted).toBe(true)
  expect(session.save).not.toHaveBeenCalled()
  expect(backendMock).not.toHaveBeenCalled()
})

it.each(["replaced", "removed"])(
  "rejects answers for A when another tab has %s its result after survey entry",
  async (change) => {
    await mount(RootStep.result)
    await act(async () => {
      expect(await context.startSurvey()).toEqual({ ok: true })
    })
    session.lastCompletedAnalysisId = ANALYSIS_ID_B
    session.rootStep = RootStep.survey
    if (change === "replaced") await writeStoredResult("encrypted-B")
    else await writeStoredResult(null)
    session.save.mockClear()
    await act(async () => {
      expect(
        await context.completeSurveySubmission(
          createAnswers(),
          initialDefinitionId,
        ),
      ).toEqual({
        ok: false,
        reason: "analysis_mismatch",
      })
    })
    expect(context.result?.analysisId).toBe(ANALYSIS_ID_A)
    expect(session.save).not.toHaveBeenCalled()
    expect(backendMock).not.toHaveBeenCalled()
    expect(await readStoredResult()).toBe(
      change === "replaced" ? "encrypted-B" : null,
    )
  },
)

it("submits answers with the matching session-owned ID and retains the result", async () => {
  await mount(RootStep.result)
  await act(async () => {
    await context.startSurvey()
  })
  await act(async () => {
    expect(
      await context.completeSurveySubmission(
        createAnswers(),
        initialDefinitionId,
      ),
    ).toEqual({
      ok: true,
    })
  })
  await settle(() => expect(backendMock).toHaveBeenCalledTimes(1))
  expect(JSON.parse(backendMock.mock.calls[0][1].body).analysisId).toBe(
    ANALYSIS_ID_A,
  )
  expect(context.rootStep).toBe(RootStep.thanks)
  expect(await readStoredResult()).not.toBeNull()
  expect(context.result?.surveySubmitted).toBe(true)
})

it("offers researcher guidance without reanalysis after losing an initial result", async () => {
  await writeStoredResult(null)
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  await act(async () => {
    await context.returnToResult()
  })
  expect(container.textContent).toContain("ページを再読み込み")
  const prepareButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "書類の準備へ戻る",
  )
  expect(prepareButton).toBeUndefined()
  expect(container.textContent).toContain("再解析せず研究者にご連絡")
})

it.each(["transport", "server"])(
  "preserves completed state on a temporary %s failure and restores it on reload",
  async (boundary) => {
    if (boundary === "transport")
      decryptMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    else decryptMock.mockResolvedValueOnce({ ok: false })
    await mount(RootStep.result)
    expect(await readStoredResult()).toBe("encrypted-A")
    expect(session.lastCompletedAnalysisId).toBe(ANALYSIS_ID_A)
    expect(session.save).not.toHaveBeenCalled()
    expect(container.textContent).toContain("ページを再読み込み")
    await act(async () => root.unmount())
    await mount(RootStep.result)
    expect(context.result).toEqual(resultA)
    expect(container.textContent).toContain("AnalysisResult A")
    expect(session.save).not.toHaveBeenCalled()
  },
)

it("does not claim submission when session acquisition fails before sending", async () => {
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  getSessionMock.mockRejectedValueOnce(new Error("session unavailable"))
  await act(async () => {
    expect(
      await context.completeSurveySubmission(
        createAnswers(),
        initialDefinitionId,
      ),
    ).toEqual({
      ok: false,
      reason: "step_state_write_failed",
    })
  })
  expect(backendMock).not.toHaveBeenCalled()
  expect(await readStoredResult()).toContain("sealed:")
})

it("reports confirmed submission separately when the following session save fails", async () => {
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  session.save
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("save failed"))
  await act(async () => {
    expect(
      await context.completeSurveySubmission(
        createAnswers(),
        initialDefinitionId,
      ),
    ).toEqual({
      ok: false,
      reason: "survey_submitted_state_write_failed",
    })
  })
  await settle(() => expect(backendMock).toHaveBeenCalledTimes(1))
  expect(context.rootStep).toBe(RootStep.survey)
  expect(await readStoredResult()).toContain("sealed:")
})

it.each(["pending", "unavailable"])(
  "preserves results and answers on a submit attempt while restoration is %s",
  async (status) => {
    session.rootStep = RootStep.survey
    let finish!: (value: AnalysisResultReadOutcome) => void
    if (status === "pending")
      decryptMock.mockReturnValueOnce(
        new Promise<AnalysisResultReadOutcome>((resolve) => {
          finish = resolve
        }),
      )
    else decryptMock.mockResolvedValueOnce({ ok: false })
    await mount(RootStep.survey, status !== "pending")
    const answers = createAnswers()
    await act(async () => {
      for (const [key, value] of Object.entries(answers))
        context.updateSurveyAnswer(key, value)
    })
    const form = container.querySelector("form") as HTMLFormElement
    expect(form.checkValidity()).toBe(true)
    await act(async () => form.requestSubmit())
    expect(await readStoredResult()).toBe("encrypted-A")
    expect(session.lastCompletedAnalysisId).toBe(ANALYSIS_ID_A)
    expect(context.rootStep).toBe(RootStep.survey)
    expect(context.surveyAnswer).toEqual(answers)
    expect(backendMock).not.toHaveBeenCalled()
    expect(session.save).not.toHaveBeenCalled()
    if (status === "pending") {
      await act(async () => finish({ ok: true, result: resultA }))
      await settle(() => expect(context.isRestoringResult).toBe(false))
      await act(async () => form.requestSubmit())
      await settle(() => expect(context.rootStep).toBe(RootStep.thanks))
      await settle(() => expect(backendMock).toHaveBeenCalledTimes(1))
    } else {
      const backButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "結果表示に戻る",
      ) as HTMLButtonElement
      await act(async () => backButton.click())
      expect(container.textContent).toContain("ページを再読み込み")
      expect(await readStoredResult()).toBe("encrypted-A")
    }
  },
)

it.each([
  "prepareNewAnalysis",
  "confirmAuthentication",
  "resetToStart",
] as const)("clears result and answers when %s is accepted", async (action) => {
  session.stage = Stage.followUp
  await mount(RootStep.result)
  await act(async () => context.updateSurveyAnswer("q1", "old answer"))
  if (action === "confirmAuthentication") {
    session.stage = Stage.confirmationSent
    session.rootStep = RootStep.auth
  }
  await act(async () => {
    expect((await context[action]()).ok).toBe(true)
  })
  expect(context.rootStep).toBe(
    action === "resetToStart" ? RootStep.start : RootStep.document,
  )
  expect(context.result).toBeNull()
  expect(context.surveyAnswer).toEqual({})
  expect(await readStoredResult()).toBeNull()
})

it("shows a rejected return transition without losing answers and allows retry", async () => {
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  await act(async () => context.updateSurveyAnswer("q1", "saved answer"))
  getSessionMock.mockRejectedValueOnce(new Error("session unavailable"))
  const backButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "結果表示に戻る",
  ) as HTMLButtonElement
  await act(async () => backButton.click())
  expect(context.rootStep).toBe(RootStep.survey)
  expect(context.surveyAnswer.q1).toBe("saved answer")
  expect(updateStatusMock).toHaveBeenCalledWith(
    expect.objectContaining({ tone: "error" }),
  )
  expect(backButton.disabled).toBe(false)
  await act(async () => backButton.click())
  expect(context.rootStep).toBe(RootStep.result)
  expect(updateStatusMock).toHaveBeenLastCalledWith(null)
})

it.each(["model", "metadata", "storage"])(
  "keeps input and supports explicit recovery through repeated %s failures",
  async (boundary) => {
    await mount(RootStep.result)
    session.stage = Stage.followUp
    await act(async () => {
      await context.returnToResult()
    })
    await act(async () => {
      await context.prepareNewAnalysis()
    })
    if (boundary === "storage") encryptMock.mockResolvedValueOnce(null)
    batchText = "partial output"
    startJobMock.mockResolvedValue({
      ok: true,
      analysisId: ANALYSIS_ID_A,
      status: boundary === "model" ? "failed" : "ready",
      startedAtMs: Date.now(),
      elapsedMs: 0,
    })
    finalizeMock.mockResolvedValue(
      boundary === "metadata"
        ? { ok: false, reason: "finalize_failed" }
        : { ok: true, metadata: resultA },
    )
    session.save.mockClear()
    session.save
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        // A failed cookie write leaves the next request at the persisted result step.
        session.rootStep = RootStep.result
        throw new Error("cookie write failed")
      })
    await act(async () => {
      await context.startAnalysis({
        jobId: "failed-job",
        documents: { doc: "input" },
        documentNames: { doc: "Document" },
      })
    })
    expect(context.rootStep).toBe(RootStep.result)
    if (boundary !== "model") {
      expect(container.textContent).not.toContain("partial output")
      expect(context.result).toBeNull()
      await settle(() =>
        expect(
          [...container.querySelectorAll("button")].some(
            (button) => button.textContent === "完了処理を再試行",
          ),
        ).toBe(true),
      )
      const retry = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "完了処理を再試行",
      ) as HTMLButtonElement
      expect(retry).toBeDefined()
      if (boundary === "storage") encryptMock.mockResolvedValueOnce(null)
      await act(async () => retry.click())
      await settle(() => expect(retry.disabled).toBe(false))
      expect(container.textContent).not.toContain("partial output")
      expect(context.analysisJob?.documents).toEqual({ doc: "input" })
      expect(context.result).toBeNull()
      finalizeMock.mockResolvedValue({ ok: true, metadata: resultA })
      await act(async () => retry.click())
      await settle(() => expect(context.result?.text).toBe("partial output"))
      await settle(() => expect(context.analysisJob).toBeNull())
      expect(container.textContent).toContain("解析が終了しました。")
      expect(await readStoredResult()).toContain("sealed:")
      expect(startJobMock).toHaveBeenCalledTimes(1)
      expect(session.save).toHaveBeenCalledTimes(1)
      return
    }
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "解析は停止しています",
    )
    expect(container.textContent).not.toContain("partial output")
    expect(session.save).toHaveBeenCalledTimes(1)
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "書類の準備へ戻る",
    ) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    getSessionMock.mockRejectedValueOnce(new Error("temporary session failure"))
    await act(async () => button.click())
    expect(button.disabled).toBe(false)
    expect(context.rootStep).toBe(RootStep.result)
    expect(startJobMock).toHaveBeenCalledTimes(1)
    await act(async () => button.click())
    expect(button.disabled).toBe(false)
    expect(context.rootStep).toBe(RootStep.result)
    await act(async () => button.click())
    expect(context.rootStep).toBe(RootStep.document)
    expect(context.analysisJob?.documents).toEqual({ doc: "input" })
    expect(context.analysisJob?.documentNames).toEqual({ doc: "Document" })
  },
)

it.each(["invalid", "valid", "malformed"])(
  "ignores an old %s result when shared storage changes during decryption",
  async (outcome) => {
    let finish!: (value: unknown) => void
    decryptMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await mount(RootStep.result, false)
    await writeStoredResult("encrypted-B")
    session.lastCompletedAnalysisId = ANALYSIS_ID_B
    await act(async () =>
      finish({
        ok: true,
        result:
          outcome === "invalid"
            ? null
            : outcome === "valid"
              ? resultA
              : { text: "malformed" },
      }),
    )
    expect(await readStoredResult()).toBe("encrypted-B")
    expect(session.lastCompletedAnalysisId).toBe(ANALYSIS_ID_B)
    expect(session.save).not.toHaveBeenCalled()
    expect(context.result).toBeNull()
    expect(container.textContent).toContain("ページを再読み込み")
    await act(async () => root.unmount())
    decryptMock.mockResolvedValueOnce({
      ok: true,
      result: {
        ...resultA,
        analysisId: ANALYSIS_ID_B,
        text: "AnalysisResult B",
      },
    })
    await mount(RootStep.result)
    expect(container.textContent).toContain("AnalysisResult B")
    expect(context.result?.analysisId).toBe(ANALYSIS_ID_B)
  },
)

it(" keeps confirmed survey submission distinct from a storage deletion failure", async () => {
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  await act(async () => {
    for (const [key, value] of Object.entries(createAnswers()))
      context.updateSurveyAnswer(key, value)
  })
  const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    if (args[0]?.analysisResult?.value === null)
      throw new DOMException("Storage blocked", "SecurityError")
    return put.apply(this, args)
  })
  const form = container.querySelector("form") as HTMLFormElement
  await act(async () => form.requestSubmit())
  await settle(() => expect(backendMock).toHaveBeenCalledTimes(1))
  expect(context.rootStep).toBe(RootStep.thanks)
  expect(await readStoredResult()).toContain("sealed:")
  expect(context.result?.surveySubmitted).toBe(true)
  expect(updateStatusMock).toHaveBeenLastCalledWith(null)
})

it("keeps a newer result saved by another tab while survey submission is pending", async () => {
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  await act(async () => {
    for (const [key, value] of Object.entries(createAnswers()))
      context.updateSurveyAnswer(key, value)
  })
  let finish!: (response: Response) => void
  backendMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  const form = container.querySelector("form") as HTMLFormElement
  await act(async () => form.requestSubmit())
  await settle(() => expect(backendMock).toHaveBeenCalledTimes(1))
  expect(context.rootStep).toBe(RootStep.survey)
  await writeStoredResult("encrypted-B")
  decryptMock.mockResolvedValueOnce({
    ok: true,
    result: { ...resultA, analysisId: ANALYSIS_ID_B },
  })
  await act(async () => finish(Response.json({ ok: true })))
  expect(context.rootStep).toBe(RootStep.thanks)
  expect(await readStoredResult()).toBe("encrypted-B")
  expect(updateStatusMock).toHaveBeenLastCalledWith(null)
})

it.each(["response", "cookie"])(
  "retries identical answers after %s loss, editing attempts, and reload",
  async (failure) => {
    session.rootStep = RootStep.survey
    await mount(RootStep.survey)
    const answers = createAnswers()
    if (failure === "response")
      backendMock.mockRejectedValueOnce(new TypeError("response lost"))
    else
      session.save
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(async () => {
          delete session.submittedAnalysisId
          session.stage = Stage.authenticated
          session.rootStep = RootStep.survey
          throw new Error("cookie write failed")
        })
    await act(async () => {
      expect(
        (await context.completeSurveySubmission(answers, initialDefinitionId))
          .ok,
      ).toBe(false)
    })
    const firstBody = backendMock.mock.calls[0][1].body
    await act(async () =>
      context.updateSurveyAnswer(Object.keys(answers)[0], "changed"),
    )
    expect(context.surveyAnswer).toEqual(answers)
    expect(container.querySelector("fieldset")?.disabled).toBe(true)
    await act(async () => root.unmount())
    await mount(RootStep.survey)
    expect(context.surveyAnswer).toEqual(answers)
    await act(async () => {
      expect(
        (
          await context.completeSurveySubmission(
            { changed: "answer" },
            initialDefinitionId,
          )
        ).ok,
      ).toBe(true)
    })
    expect(backendMock.mock.calls[1][1].body).toBe(firstBody)
    await settle(() => expect(context.rootStep).toBe(RootStep.thanks))
  },
)

it("reports an already submitted survey without resealing answers or changing either tab", async () => {
  await mount(RootStep.survey)
  await act(async () => {
    for (const [name, value] of Object.entries(createAnswers()))
      context.updateSurveyAnswer(name, value)
  })
  session.stage = Stage.followUp
  session.rootStep = RootStep.thanks
  decryptMock.mockResolvedValueOnce({
    ok: true,
    result: { ...resultA, pendingSurveyAnswer: createAnswers() },
    surveySubmitted: true,
  })
  const form = container.querySelector("form") as HTMLFormElement
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await settle(() => expect(updateStatusMock).toHaveBeenCalled())
  expect(updateStatusMock).toHaveBeenLastCalledWith({
    message:
      "この解析のアンケートは送信済みです。再送信は不要です。ページを再読み込みして現在の状態を確認してください。",
    tone: "error",
  })
  expect(encryptMock).not.toHaveBeenCalled()
  expect(backendMock).not.toHaveBeenCalled()
  expect(session.save).not.toHaveBeenCalled()
  expect(context.rootStep).toBe(RootStep.survey)
  expect(context.surveyAnswer).toEqual(createAnswers())
  expect(await readStoredResult()).toBe("encrypted-A")
})

it.each(["unavailable", "transport-failure"])(
  "retains the draft and allows retry after questionnaire check %s",
  async (failure) => {
    session.rootStep = RootStep.survey
    await mount(RootStep.survey)
    const answers = createAnswers()
    await act(async () => {
      for (const [name, value] of Object.entries(answers))
        context.updateSurveyAnswer(name, value, initialDefinitionId)
    })
    if (failure === "unavailable")
      sealSurveyMock.mockResolvedValueOnce({
        ok: false,
        reason: "questionnaire_check_failed",
      })
    else sealSurveyMock.mockRejectedValueOnce(new Error("response lost"))
    const form = container.querySelector("form") as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
    })
    await settle(() => expect(updateStatusMock).toHaveBeenCalled())
    expect(updateStatusMock).toHaveBeenLastCalledWith({
      message:
        "質問票を確認できませんでした。アンケートは送信されていません。時間をおいて、もう一度お試しください。",
      tone: "error",
    })
    expect(context.rootStep).toBe(RootStep.survey)
    expect(context.surveyAnswer).toEqual(answers)
    expect(await readStoredResult()).toBe("encrypted-A")
    expect(encryptMock).not.toHaveBeenCalled()
    expect(backendMock).not.toHaveBeenCalled()
    expect(session.save).not.toHaveBeenCalled()
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      )
    })
    await settle(() => expect(backendMock).toHaveBeenCalledTimes(1))
    await settle(() => expect(context.rootStep).toBe(RootStep.thanks))
  },
)

it("does not submit when freezing the original answers fails", async () => {
  session.rootStep = RootStep.survey
  await mount(RootStep.survey)
  encryptMock.mockResolvedValueOnce(null)
  await act(async () => {
    expect(
      await context.completeSurveySubmission(
        createAnswers(),
        initialDefinitionId,
      ),
    ).toEqual({
      ok: false,
      reason: "survey_retry_storage_failed",
    })
  })
  expect(backendMock).not.toHaveBeenCalled()
  expect(context.result?.pendingSurveyAnswer).toBeUndefined()
  expect(await readStoredResult()).toBe("encrypted-A")
})

it.each(["response", "transport-failure"])(
  "stops an outdated save after another tab completes B (%s)",
  async (outcome) => {
    await mount(RootStep.result)
    session.stage = Stage.followUp
    await act(async () => {
      await context.returnToResult()
    })
    await act(async () => context.prepareNewAnalysis())
    let finish!: () => void
    encryptMock.mockReturnValueOnce(
      new Promise((resolve, reject) => {
        finish = () =>
          outcome === "response"
            ? resolve("late-encrypted-A")
            : reject(new Error("response lost"))
      }),
    )
    batchText = "Late result A"
    startJobMock.mockResolvedValue({
      ok: true,
      analysisId: ANALYSIS_ID_A,
      status: "ready",
      startedAtMs: Date.now(),
      elapsedMs: 0,
    })
    finalizeMock.mockResolvedValue({ ok: true, metadata: resultA })
    await act(async () =>
      context.startAnalysis({
        jobId: "job-A",
        documents: { doc: "input A" },
      }),
    )
    await settle(() => expect(encryptMock).toHaveBeenCalledTimes(1))
    await writeStoredResult("encrypted-B")
    session.lastCompletedAnalysisId = ANALYSIS_ID_B
    session.rootStep = RootStep.result
    session.save.mockClear()
    await act(async () => finish())

    expect(await readStoredResult()).toBe("encrypted-B")
    expect(session.lastCompletedAnalysisId).toBe(ANALYSIS_ID_B)
    expect(session.rootStep).toBe(RootStep.result)
    expect(session.save).not.toHaveBeenCalled()
    await settle(() => expect(context.analysisJob).toBeNull())
    expect(context.result).toBeNull()
    expect(container.textContent).toContain("ページを再読み込み")
    expect(startJobMock).toHaveBeenCalledTimes(1)
    expect(updateStatusMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.stringContaining("別のタブ") }),
    )
    await act(async () => root.unmount())
    await mount(RootStep.result)
    expect(context.result?.analysisId).toBe(ANALYSIS_ID_B)
  },
)

// Admission has dedicated authority tests and real-cookie browser coverage.
vi.mock("@/features/session/session-operation", () => ({
  withSessionRead: (_token: unknown, operation: () => Promise<unknown>) =>
    operation(),
  withSessionOperation: (
    _token: unknown,
    _kind: string,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

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
