/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import {
  AppContextProvider,
  useAppContext,
} from "@/features/app-context/app-context-provider"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import {
  MessageContextProvider,
  useMessageContext,
} from "@/features/message/message-context-provider"
import SectionExplanation from "./section-explanation"
import SectionStart from "./section-start"

const { moveToExplanationAction, moveToConsentAction } = vi.hoisted(() => ({
  moveToExplanationAction: vi.fn(),
  moveToConsentAction: vi.fn(),
}))
vi.mock("@/features/app-context/actions-step-state", () => ({
  moveToExplanationAction,
  moveToConsentAction,
}))
vi.mock("@/features/llm/analysis-result-storage", () => ({
  readAnalysisResultFromBrowser: vi.fn(async () => ({
    ok: true,
    result: null,
  })),
  saveAnalysisResultInBrowser: vi.fn(async () => ({ ok: true })),
  invalidateAnalysisResultStorageOperations: vi.fn(),
}))
vi.mock("@/assets/welcome.mdx", () => ({
  default: () => <p>Welcome</p>,
}))
vi.mock("@/assets/explanation.mdx", () => ({
  default: () => <p>Explanation</p>,
}))

function Probe() {
  const { rootStep } = useAppContext()
  const { statusMessage } = useMessageContext()
  return (
    <>
      {rootStep === RootStep.start ? (
        <SectionStart />
      ) : rootStep === RootStep.explanation ? (
        <SectionExplanation />
      ) : (
        <p>Consent</p>
      )}
      <p role="alert">{statusMessage?.message}</p>
      <p data-testid="step">{rootStep}</p>
    </>
  )
}

it.each([
  { step: RootStep.start, transportFailure: false },
  { step: RootStep.start, transportFailure: true },
  { step: RootStep.explanation, transportFailure: false },
  { step: RootStep.explanation, transportFailure: true },
])(
  "shows navigation failure and retries from $step (transport=$transportFailure)",
  async ({ step, transportFailure }) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    const action =
      step === RootStep.start ? moveToExplanationAction : moveToConsentAction
    const nextStep =
      step === RootStep.start ? RootStep.explanation : RootStep.consent
    let finish!: () => void
    action.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            transportFailure
              ? reject(new Error("network unavailable"))
              : resolve({ ok: false, reason: "step_state_write_failed" })
        }),
    )
    action.mockResolvedValueOnce({
      ok: true,
      stepState: { stage: Stage.unauthenticated, step: nextStep },
    })
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <AppContextProvider
            initialStepState={{ stage: Stage.unauthenticated, step }}
          >
            <MessageContextProvider>
              <Probe />
            </MessageContextProvider>
          </AppContextProvider>,
        ),
      )
      const button =
        container.querySelectorAll("button")[step === RootStep.start ? 0 : 1]
      if (!button) throw new Error("Navigation button is missing")
      await act(async () => button.click())
      expect(action).toHaveBeenCalledTimes(1)
      expect(button.disabled).toBe(true)
      expect(button.textContent).toBe("移動中...")
      await act(async () => button.click())
      expect(action).toHaveBeenCalledTimes(1)
      await act(async () => finish())
      expect(container.querySelector('[data-testid="step"]')?.textContent).toBe(
        step,
      )
      expect(button.disabled).toBe(false)
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "時間をおいて再度お試しください。",
      )
      await act(async () => button.click())
      expect(action).toHaveBeenCalledTimes(2)
      expect(container.querySelector('[data-testid="step"]')?.textContent).toBe(
        nextStep,
      )
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("")
    } finally {
      await act(async () => root.unmount())
      container.remove()
      window.localStorage.clear()
      vi.resetAllMocks()
    }
  },
)

vi.mock("@/features/session/use-session-admission", () => ({
  useSessionAdmission: () => ({
    status: "ready",
    initialStep: null,
  }),
}))

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
