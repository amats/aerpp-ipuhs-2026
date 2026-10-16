/** @vitest-environment jsdom */

import { act, type ComponentProps, useReducer } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AnalysisResult } from "@/features/app-context/analysis-result-types"
import type {
  CompleteSurveySubmissionResult,
  StepStateTransitionResult,
} from "@/features/app-context/app-context-types"
import { Stage } from "@/features/app-context/stage-types"
import type { SurveyAnswer } from "@/features/survey/survey-answer-types"
import type { SurveyQuestionSet } from "@/features/survey/survey-question-types"
import SectionSurvey from "./section-survey"

const completeSurveySubmissionMock = vi.fn<
  (surveyAnswer: SurveyAnswer) => Promise<CompleteSurveySubmissionResult>
>(async () => ({
  ok: true,
  resultCleared: true,
}))

const appContextValue = {
  completeSurveySubmission: completeSurveySubmissionMock,
  returnToResult: vi.fn<() => Promise<StepStateTransitionResult>>(async () => ({
    ok: true,
  })),
  isRestoringResult: false,
  prepareNewAnalysis: vi.fn<
    () => Promise<{
      ok: true
      resultCleared: boolean
    }>
  >(async () => ({
    ok: true,
    resultCleared: true,
  })),
  updateSurveyAnswer: vi.fn(),
  surveyAnswer: {} as SurveyAnswer,
  result: {
    analysisId: "analysis-1",
    analysisWorkspaceVersion: "1.0.0",
    modelName: "model-1",
    processingDurationSeconds: 3,
    documentCount: 2,
    documentGraphemeCount: 10,
    resultGraphemeCount: 20,
    text: "stored result",
  } as AnalysisResult | null,
  stage: Stage.authenticated as Stage,
}
const updateStatusMock = vi.fn()
vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => {
    const [, render] = useReducer((value: number) => value + 1, 0)
    return {
      ...appContextValue,
      updateSurveyAnswer: (name: string, value: string) => {
        appContextValue.updateSurveyAnswer(name, value)
        render()
      },
    }
  },
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    updateStatusMessage: updateStatusMock,
  }),
}))

const initialSurveyQuestionSet: SurveyQuestionSet = {
  definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
  version: "v2_initial",
  description: "initial description",
  questions: [
    {
      id: "BG1",
      text: "所属",
      type: "single_choice",
      options: ["看護学科", "医科学センター"],
      required: true,
    },
    {
      id: "q1",
      text: "Question 1",
      type: "likert7",
      description: [],
      options: ["1", "2", "3", "4", "5", "6", "7"],
      required: true,
    },
    {
      id: "free1",
      text: "Free 1",
      type: "text",
      placeholder: "",
      required: false,
    },
  ],
}

const followUpSurveyQuestionSet: SurveyQuestionSet = {
  definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
  version: "v2_followup",
  description: "follow-up description",
  questions: initialSurveyQuestionSet.questions,
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe("SectionSurvey", () => {
  let container: HTMLDivElement
  let root: Root

  async function renderSurvey(
    props: Partial<ComponentProps<typeof SectionSurvey>> = {},
  ) {
    await act(async () =>
      root.render(
        <SectionSurvey
          initialSurveyQuestionSet={initialSurveyQuestionSet}
          followUpSurveyQuestionSet={followUpSurveyQuestionSet}
          {...props}
        />,
      ),
    )
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    appContextValue.result = {
      analysisId: "analysis-1",
      analysisWorkspaceVersion: "1.0.0",
      modelName: "model-1",
      processingDurationSeconds: 3,
      documentCount: 2,
      documentGraphemeCount: 10,
      resultGraphemeCount: 20,
      text: "stored result",
    }
    appContextValue.isRestoringResult = false
    appContextValue.stage = Stage.authenticated
    appContextValue.completeSurveySubmission.mockReset()
    appContextValue.returnToResult.mockReset()
    appContextValue.returnToResult.mockResolvedValue({ ok: true })
    appContextValue.prepareNewAnalysis.mockReset()
    updateStatusMock.mockReset()
    appContextValue.surveyAnswer = {}
    appContextValue.updateSurveyAnswer.mockReset()
    appContextValue.updateSurveyAnswer.mockImplementation((name, value) => {
      appContextValue.surveyAnswer = {
        ...appContextValue.surveyAnswer,
        [name]: value,
      }
    })
    completeSurveySubmissionMock.mockResolvedValue({
      ok: true,
    })
    window.scrollTo = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function submitSurveyForm() {
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        )
    })
  }

  it.each([Stage.authenticated, Stage.followUp])(
    "renders question labels and preserves required fields at stage %s",
    async (stage) => {
      appContextValue.stage = stage
      await renderSurvey()

      for (const question of initialSurveyQuestionSet.questions) {
        if (question.type === "section") continue
        const group = container.querySelector(
          `[data-survey-question="${question.id}"]`,
        )
        const label = group?.querySelector("legend, label")
        expect(label?.textContent).toBe(question.text)
        expect(
          group?.querySelector<HTMLInputElement>("input, select, textarea")
            ?.required,
        ).toBe(question.required)
      }
      expect(
        container.querySelector("h2")?.parentElement?.textContent,
      ).toContain(
        stage === Stage.followUp
          ? followUpSurveyQuestionSet.description
          : initialSurveyQuestionSet.description,
      )
      expect(container.querySelector('[aria-invalid="true"]')).toBeNull()
    },
  )

  it("submits the current answers after editing the controls", async () => {
    await renderSurvey()

    await act(async () => {
      const select = container.querySelector("select") as HTMLSelectElement
      select.value = "看護学科"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await act(async () => {
      container
        .querySelector<HTMLInputElement>('input[name="q1"][value="7"]')
        ?.click()
    })

    await submitSurveyForm()

    expect(appContextValue.completeSurveySubmission).toHaveBeenCalledWith(
      {
        BG1: "看護学科",
        q1: "7",
      },
      `jcs-v1:sha256:${"a".repeat(64)}`,
    )
  })

  it.each([Stage.authenticated, Stage.followUp])(
    "keeps guidance beside the relevant controls without losing instructions at stage %s",
    async (stage) => {
      appContextValue.stage = stage
      const introduction = "今回の利用についてご回答ください。"
      const evaluationGuidance =
        "判断できない評価項目は未回答のままお進みください（「どちらともいえない」とは区別します）。"
      const commentGuidance =
        "自由記述は任意です。個人情報・未公開研究の機密情報は記載しないでください。"
      const questionSet = {
        ...initialSurveyQuestionSet,
        description: introduction + evaluationGuidance + commentGuidance,
      }
      await renderSurvey({
        initialSurveyQuestionSet: questionSet,
        followUpSurveyQuestionSet: questionSet,
      })

      expect(
        container.querySelector("h2")?.parentElement?.querySelector("p")
          ?.textContent,
      ).toBe(introduction)
      expect(
        container.querySelector('[data-survey-question="q1"]')
          ?.previousElementSibling?.textContent,
      ).toBe(evaluationGuidance)
      expect(
        container.querySelector('[data-survey-question="free1"]')
          ?.previousElementSibling?.textContent,
      ).toBe(commentGuidance)
      for (const guidance of [
        introduction,
        evaluationGuidance,
        commentGuidance,
      ]) {
        expect(container.textContent?.split(guidance)).toHaveLength(2)
      }
    },
  )

  it("retains all instructions when the corresponding question type is absent", async () => {
    const description =
      "ご回答ください。判断できない評価項目は未回答にできます。自由記述は任意です。個人情報・機密情報は記載しないでください。追加の案内です。"
    await renderSurvey({
      initialSurveyQuestionSet: {
        ...initialSurveyQuestionSet,
        description,
        questions: initialSurveyQuestionSet.questions.filter(
          (question) => question.type === "single_choice",
        ),
      },
    })

    expect(
      container.querySelector("h2")?.parentElement?.querySelector("p")
        ?.textContent,
    ).toBe(description)
  })

  it("renders a missing answer as blank when its ID matches an inherited property", async () => {
    await renderSurvey({
      initialSurveyQuestionSet: {
        ...initialSurveyQuestionSet,
        questions: [
          {
            id: "toString",
            text: "Custom question",
            type: "text",
            placeholder: "",
            required: true,
          },
        ],
      },
    })
    expect(container.querySelector("textarea")?.value).toBe("")
    await submitSurveyForm()
    expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
    expect(container.textContent).toContain("必須項目です。回答してください。")
  })

  it("does not submit when required answers are missing", async () => {
    await renderSurvey()

    await submitSurveyForm()

    expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
    expect(updateStatusMock).not.toHaveBeenCalled()
    expect(
      container.querySelector("select")?.getAttribute("aria-invalid"),
    ).toBe("true")
    expect(document.activeElement).toBe(container.querySelector("select"))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "instant",
    })
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(
      container.querySelector('[data-survey-question="BG1"]'),
    )
    expect(window.scrollTo).not.toHaveBeenCalled()

    await submitSurveyForm()

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(container.querySelector("select"))
    expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
  })

  it.each(["BG1", "q1"])(
    "clears only %s and requires a new answer before submission",
    async (questionId) => {
      appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7" }
      await renderSurvey()
      const question = container.querySelector(
        `[data-survey-question="${questionId}"]`,
      ) as HTMLElement
      const clearButton = question.querySelector("button")
      if (questionId === "BG1") {
        expect(clearButton).toBeNull()
        await act(async () => {
          const select = question.querySelector("select") as HTMLSelectElement
          select.value = ""
          select.dispatchEvent(new Event("change", { bubbles: true }))
        })
      } else {
        expect(clearButton?.disabled).toBe(false)
        await act(async () => clearButton?.click())
        expect(clearButton?.disabled).toBe(true)
      }

      expect(appContextValue.surveyAnswer).toEqual({
        BG1: "看護学科",
        q1: "7",
        [questionId]: "",
      })
      expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
      if (questionId === "BG1")
        expect(question.querySelector("select")?.value).toBe("")
      else expect(question.querySelector("input:checked")).toBeNull()

      await submitSurveyForm()
      expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
      expect(question.textContent).toContain("必須項目です。回答してください。")

      await act(async () => {
        if (questionId === "BG1") {
          const select = question.querySelector("select") as HTMLSelectElement
          select.value = "看護学科"
          select.dispatchEvent(new Event("change", { bubbles: true }))
        } else {
          question.querySelector<HTMLInputElement>('input[value="7"]')?.click()
        }
      })
      if (clearButton) expect(clearButton.disabled).toBe(false)
      expect(question.textContent).not.toContain(
        "必須項目です。回答してください。",
      )
      await submitSurveyForm()
      expect(appContextValue.completeSurveySubmission).toHaveBeenCalledWith(
        {
          BG1: "看護学科",
          q1: "7",
        },
        `jcs-v1:sha256:${"a".repeat(64)}`,
      )
    },
  )

  it("submits cleared optional choices as unanswered in the follow-up survey", async () => {
    appContextValue.stage = Stage.followUp
    appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7" }
    await renderSurvey({
      followUpSurveyQuestionSet: {
        ...followUpSurveyQuestionSet,
        questions: followUpSurveyQuestionSet.questions.map((question) => ({
          ...question,
          required: false,
        })),
      },
    })
    await act(async () => {
      const select = container.querySelector("select") as HTMLSelectElement
      select.value = ""
      select.dispatchEvent(new Event("change", { bubbles: true }))
      container
        .querySelector<HTMLButtonElement>('[data-survey-question="q1"] button')
        ?.click()
    })
    await submitSurveyForm()
    expect(appContextValue.completeSurveySubmission).toHaveBeenCalledWith(
      {
        BG1: "",
        q1: "",
      },
      `jcs-v1:sha256:${"a".repeat(64)}`,
    )
  })

  it.each(["restoring", "submitting", "retry"])(
    "prevents clearing answers while %s",
    async (state) => {
      const answers = { BG1: "看護学科", q1: "7" }
      appContextValue.surveyAnswer = answers
      appContextValue.isRestoringResult = state === "restoring"
      if (state === "retry" && appContextValue.result) {
        appContextValue.result.pendingSurveyAnswer = answers
        appContextValue.result.pendingQuestionnaireId =
          initialSurveyQuestionSet.definitionId
      }
      const deferred = createDeferred<CompleteSurveySubmissionResult>()
      if (state === "submitting")
        completeSurveySubmissionMock.mockReturnValueOnce(deferred.promise)
      await renderSurvey()
      if (state === "submitting") await submitSurveyForm()

      expect(container.querySelector("select")?.matches(":disabled")).toBe(true)
      const clearButton = container.querySelector<HTMLButtonElement>(
        '[data-survey-question="q1"] button',
      ) as HTMLButtonElement
      expect(clearButton.matches(":disabled")).toBe(true)
      await act(async () => clearButton.click())
      expect(appContextValue.updateSurveyAnswer).not.toHaveBeenCalled()
      expect(appContextValue.surveyAnswer).toEqual(answers)
      if (state === "submitting")
        await act(async () => deferred.resolve({ ok: true }))
    },
  )

  it("shows and focuses inline errors on submit clicks and clears them as answers are corrected", async () => {
    await renderSurvey()
    expect(container.querySelector('[role="alert"]')).toBeNull()

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click(),
    )
    expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
    expect(updateStatusMock).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')).toBeNull()

    const select = container.querySelector("select") as HTMLSelectElement
    expect(select.getAttribute("aria-invalid")).toBe("true")
    expect(
      document.getElementById(select.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("必須項目です。回答してください。")
    const radio = container.querySelector<HTMLInputElement>(
      'input[name="q1"][value="7"]',
    ) as HTMLInputElement
    expect(radio.getAttribute("aria-invalid")).toBe("true")
    expect(
      document.getElementById(radio.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("必須項目です。回答してください。")
    expect(
      container.querySelector("textarea")?.getAttribute("aria-invalid"),
    ).toBeNull()

    await act(async () => {
      select.value = "看護学科"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(select.getAttribute("aria-invalid")).toBeNull()
    expect(select.getAttribute("aria-describedby")).toBeNull()
    expect(radio.getAttribute("aria-invalid")).toBe("true")

    await submitSurveyForm()
    expect(document.activeElement).toBe(
      container.querySelector('input[name="q1"]'),
    )
    expect(
      vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1),
    ).toBe(container.querySelector('[data-survey-question="q1"]'))
    expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()

    await act(async () => {
      radio.click()
    })
    expect(radio.getAttribute("aria-invalid")).toBeNull()
    expect(radio.getAttribute("aria-describedby")).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()

    await act(async () => {
      select.value = ""
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(select.getAttribute("aria-invalid")).toBe("true")
    await act(async () => {
      select.value = "看護学科"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(select.getAttribute("aria-invalid")).toBeNull()

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click(),
    )
    expect(appContextValue.completeSurveySubmission).toHaveBeenCalledTimes(1)
  })

  it.each(["", "   "])(
    "shows a required textarea error for an answer of %j",
    async (answer) => {
      appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7", free1: answer }
      const questionSet = {
        ...initialSurveyQuestionSet,
        questions: initialSurveyQuestionSet.questions.map((question) => ({
          ...question,
          required: true,
        })),
      }
      await act(async () =>
        root.render(
          <SectionSurvey
            initialSurveyQuestionSet={questionSet}
            followUpSurveyQuestionSet={followUpSurveyQuestionSet}
          />,
        ),
      )
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.click(),
      )

      const textarea = container.querySelector(
        "textarea",
      ) as HTMLTextAreaElement
      expect(textarea.getAttribute("aria-invalid")).toBe("true")
      expect(
        document.getElementById(textarea.getAttribute("aria-describedby") ?? "")
          ?.textContent,
      ).toBe("必須項目です。回答してください。")
      expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
    },
  )

  it.each(["あ", "👨‍👩‍👧‍👦", "e\u0301"])(
    "reports oversized free text beside the field and permits correction, counting %s as one character",
    async (character) => {
      const answer = character.repeat(4001)
      appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7", free1: answer }
      await renderSurvey()
      const textarea = container.querySelector<HTMLTextAreaElement>(
        "textarea",
      ) as HTMLTextAreaElement
      await submitSurveyForm()
      expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
      expect(updateStatusMock).not.toHaveBeenCalled()
      expect(textarea.value).toBe(answer)
      expect(textarea.matches(":disabled")).toBe(false)
      expect(textarea.getAttribute("aria-invalid")).toBe("true")
      expect(
        document.getElementById(textarea.getAttribute("aria-describedby") ?? "")
          ?.textContent,
      ).toBe("4,000文字以内で回答してください。")
      expect(document.activeElement).toBe(textarea)

      appContextValue.surveyAnswer = {
        ...appContextValue.surveyAnswer,
        free1: character.repeat(4000),
      }
      await renderSurvey()
      expect(textarea.getAttribute("aria-invalid")).toBeNull()
      await submitSurveyForm()
      expect(appContextValue.completeSurveySubmission).toHaveBeenCalledWith(
        appContextValue.surveyAnswer,
        `jcs-v1:sha256:${"a".repeat(64)}`,
      )
    },
  )

  it("allows unanswered optional questions in the follow-up survey", async () => {
    appContextValue.stage = Stage.followUp
    const optionalQuestionSet = {
      ...followUpSurveyQuestionSet,
      questions: followUpSurveyQuestionSet.questions.map((question) => ({
        ...question,
        required: false,
      })),
    }
    await act(async () =>
      root.render(
        <SectionSurvey
          initialSurveyQuestionSet={initialSurveyQuestionSet}
          followUpSurveyQuestionSet={optionalQuestionSet}
        />,
      ),
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click(),
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(appContextValue.completeSurveySubmission).toHaveBeenCalledWith(
      {},
      `jcs-v1:sha256:${"a".repeat(64)}`,
    )
  })

  it("keeps the survey and offers recovery when the result cannot be read", async () => {
    appContextValue.result = null

    await renderSurvey()

    await submitSurveyForm()

    expect(appContextValue.prepareNewAnalysis).not.toHaveBeenCalled()
    expect(updateStatusMock).toHaveBeenCalledWith({
      message:
        "解析結果を確認できませんでした。「結果表示に戻る」から結果の再読み込みや書類の準備を行ってください。アンケートは送信されていません。",
      tone: "error",
    })
  })

  it("disables submission while restoring the result and resumes after it loads", async () => {
    appContextValue.isRestoringResult = true
    await renderSurvey()
    const submitButton = container.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    ) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    expect(submitButton.textContent).toBe("結果を読み込み中...")
    await submitSurveyForm()
    expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
    expect(appContextValue.prepareNewAnalysis).not.toHaveBeenCalled()
    appContextValue.isRestoringResult = false
    await renderSurvey()
    expect(submitButton.disabled).toBe(false)
    expect(submitButton.textContent).toBe("アンケートを送信")
  })

  it("shows an indeterminate send outcome on a transport failure and re-enables submission", async () => {
    appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7" }
    completeSurveySubmissionMock.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    )
    await renderSurvey()
    await submitSurveyForm()
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "error",
        message: expect.stringContaining("送信結果を確認できません"),
      }),
    )
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false)
    expect(appContextValue.surveyAnswer).toEqual({ BG1: "看護学科", q1: "7" })
  })

  it("shows a return transport failure and allows retry", async () => {
    appContextValue.returnToResult.mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    )
    await renderSurvey()
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "結果表示に戻る",
    ) as HTMLButtonElement
    await act(async () => button.click())
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    )
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(updateStatusMock).toHaveBeenLastCalledWith(null)
  })

  it("reports a submission failure without scrolling the form", async () => {
    appContextValue.completeSurveySubmission.mockResolvedValue({
      ok: false,
      reason: "submit_failed",
    })

    appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7" }
    await renderSurvey()

    await submitSurveyForm()

    expect(appContextValue.completeSurveySubmission).toHaveBeenCalledWith(
      {
        BG1: "看護学科",
        q1: "7",
      },
      `jcs-v1:sha256:${"a".repeat(64)}`,
    )
    expect(updateStatusMock).toHaveBeenCalledWith({
      message:
        "アンケートの送信に失敗しました。時間をおいて、もう一度お試しください。",
      tone: "error",
    })
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it("reports accepted answers separately from failed local cleanup without resending", async () => {
    completeSurveySubmissionMock.mockResolvedValue({
      ok: true,
      localCleanupFailed: true,
    })
    appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7" }
    await renderSurvey()
    await submitSurveyForm()
    expect(completeSurveySubmissionMock).toHaveBeenCalledOnce()
    expect(updateStatusMock).toHaveBeenLastCalledWith({
      message:
        "アンケートの送信は完了しています。ブラウザー内に保存された回答の消去を完了できませんでした。消去ボタンから再試行してください。アンケートの再送信は不要です。",
      tone: "warning",
    })
  })

  it.each(["stage_mismatch", "step_state_write_failed", "analysis_mismatch"])(
    "does not claim the survey was sent after a pre-send rejection (%s)",
    async (reason) => {
      appContextValue.completeSurveySubmission.mockResolvedValue({
        ok: false,
        reason,
      })
      appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7" }
      await renderSurvey()
      await submitSurveyForm()
      const message = updateStatusMock.mock.lastCall?.[0]?.message
      expect(message).toBeTypeOf("string")
      expect(message).not.toContain("アンケートは送信されました")
      if (reason === "analysis_mismatch")
        expect(message).toContain("再読み込み")
    },
  )

  it("shows a state update error when survey submission succeeds but state persistence fails", async () => {
    appContextValue.completeSurveySubmission.mockResolvedValue({
      ok: false,
      reason: "survey_submitted_state_write_failed",
    })

    appContextValue.surveyAnswer = { BG1: "看護学科", q1: "7" }
    await renderSurvey()

    await submitSurveyForm()

    expect(updateStatusMock).toHaveBeenCalledWith({
      message:
        "アンケートは送信されましたが、状態の更新に失敗しました。時間をおいて、もう一度お試しください。",
      tone: "error",
    })
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it("returns to the result step from the survey screen", async () => {
    await renderSurvey()

    const backButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "結果表示に戻る",
    ) as HTMLButtonElement

    await act(async () => {
      backButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(appContextValue.returnToResult).toHaveBeenCalled()
  })

  it("shows a moving state while returning to the result step", async () => {
    const deferred = createDeferred<StepStateTransitionResult>()
    appContextValue.returnToResult.mockReturnValueOnce(deferred.promise)

    await renderSurvey()

    const backButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "結果表示に戻る",
    ) as HTMLButtonElement

    await act(async () => {
      backButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(backButton.disabled).toBe(true)
    expect(backButton.textContent).toBe("移動中...")

    await act(async () => {
      deferred.resolve({ ok: true })
      await deferred.promise
    })

    expect(backButton.disabled).toBe(false)
    expect(backButton.textContent).toBe("結果表示に戻る")
  })
  it.each([undefined, `jcs-v1:sha256:${"b".repeat(64)}`])(
    "does not display a frozen old response under a replacement questionnaire (%s)",
    async (pendingQuestionnaireId) => {
      appContextValue.result = {
        ...appContextValue.result,
        pendingQuestionnaireId,
        pendingSurveyAnswer: { q1: "old answer" },
      } as NonNullable<typeof appContextValue.result>
      await renderSurvey()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "質問票が更新されたため",
      )
      expect(container.querySelector("form")).toBeNull()
      expect(appContextValue.completeSurveySubmission).not.toHaveBeenCalled()
    },
  )
})
