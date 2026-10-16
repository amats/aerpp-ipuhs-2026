/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RootStep } from "@/features/app-context/root-step-types"
import type { SurveyQuestionSet } from "@/features/survey/survey-question-types"

const homeFlowContextState: {
  rootStep: RootStep
} = {
  rootStep: RootStep.result,
}

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => homeFlowContextState,
}))

vi.mock("@/features/home-flow/section-auth", () => ({
  default: () => <div>auth</div>,
}))

vi.mock("@/features/home-flow/section-consent", () => ({
  default: () => <div>consent</div>,
}))

vi.mock("@/features/document/section-document", () => ({
  default: () => <div>document</div>,
}))

vi.mock("@/features/home-flow/section-explanation", () => ({
  default: () => <h2 tabIndex={-1}>explanation</h2>,
}))

vi.mock("@/features/home-flow/section-result", () => ({
  default: () => <h2 tabIndex={-1}>result</h2>,
}))

vi.mock("@/features/home-flow/section-start", () => ({
  default: () => <div>start</div>,
}))

vi.mock("@/features/home-flow/section-thanks", () => ({
  default: () => <div>thanks</div>,
}))

vi.mock("@/features/home-flow/section-withdrawn", () => ({
  default: () => <div>withdrawn</div>,
}))

describe("HomeFlow", () => {
  let container: HTMLDivElement

  const surveyQuestionSet = {
    id: "test",
    title: "Test",
    description: "Test description",
    questions: [],
  } as unknown as SurveyQuestionSet

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    homeFlowContextState.rootStep = RootStep.result
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ""
  })

  it("renders the result step without owning clear behavior", async () => {
    const { default: HomeFlow } = await import("./home-flow")
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <HomeFlow
          supportContactEmail="support@example.invalid"
          initialSurveyQuestionSet={surveyQuestionSet}
          followUpSurveyQuestionSet={surveyQuestionSet}
        />,
      )
    })

    expect(container.textContent).toContain("result")
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it("renders the withdrawn completion step outside the normal flow", async () => {
    homeFlowContextState.rootStep = RootStep.withdrawn

    const { default: HomeFlow } = await import("./home-flow")
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <HomeFlow
          supportContactEmail="support@example.invalid"
          initialSurveyQuestionSet={surveyQuestionSet}
          followUpSurveyQuestionSet={surveyQuestionSet}
        />,
      )
    })

    expect(container.textContent).toContain("withdrawn")
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "preserves initial focus and reveals the next step with reduced motion %s",
    async (reducedMotion) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: reducedMotion })),
      )
      const requestFrame = vi
        .spyOn(window, "requestAnimationFrame")
        .mockReturnValue(1)
      const cancelFrame = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation(() => {})
      const focus = vi.spyOn(HTMLElement.prototype, "focus")
      const { default: HomeFlow } = await import("./home-flow")
      const root = createRoot(container)
      const renderFlow = () =>
        root.render(
          <HomeFlow
            supportContactEmail="support@example.invalid"
            initialSurveyQuestionSet={surveyQuestionSet}
            followUpSurveyQuestionSet={surveyQuestionSet}
          />,
        )

      await act(async () => renderFlow())
      expect(requestFrame).not.toHaveBeenCalled()
      expect(focus).not.toHaveBeenCalled()
      expect(window.scrollTo).not.toHaveBeenCalled()

      homeFlowContextState.rootStep = RootStep.explanation
      await act(async () => renderFlow())
      expect(window.scrollTo).toHaveBeenCalledWith({
        top: 0,
        left: 0,
        behavior: "instant",
      })
      await act(async () => requestFrame.mock.calls[0][0](0))
      expect(document.activeElement).toBe(container.querySelector("h2"))
      expect(document.activeElement?.textContent).toBe("explanation")
      expect(focus).toHaveBeenCalledWith()

      await act(async () => root.unmount())
      expect(cancelFrame).toHaveBeenCalledWith(1)
    },
  )
})
