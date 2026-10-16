/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"

const useAppContextMock = vi.fn()
const useMessageContextMock = vi.fn()

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => useAppContextMock(),
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => useMessageContextMock(),
}))

describe("StepProgress", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useAppContextMock.mockReset()
    useMessageContextMock.mockReset()
    useMessageContextMock.mockReturnValue({
      dismissedInformationMessageIds: [],
      resetDismissedInformationMessages: vi.fn(),
    })
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("marks the current step with aria-current and status labels", async () => {
    useAppContextMock.mockReturnValue({
      rootStep: RootStep.auth,
      stage: Stage.authenticated,
    })

    const { default: StepProgress } = await import("./step-progress")
    const root = createRoot(container)

    await act(async () => {
      root.render(<StepProgress />)
    })

    const currentItem = container.querySelector('li[aria-current="step"]')
    expect(currentItem?.textContent).toContain("Step 4")
    expect(currentItem?.textContent).toContain("メールアドレス認証")
    expect(currentItem?.getAttribute("aria-label")).toContain("進行中")
    expect(container.textContent).toContain("進行状況")
    expect(container.textContent).toContain("Step 4 / 8")
    expect(
      Array.from(container.querySelectorAll("li")).some((item) =>
        item.getAttribute("aria-label")?.includes("完了"),
      ),
    ).toBe(true)
    expect(
      Array.from(container.querySelectorAll("li")).some((item) =>
        item.getAttribute("aria-label")?.includes("未着手"),
      ),
    ).toBe(true)
  })

  it("shows initial document preparation as step 5 from the explicit stage", async () => {
    useAppContextMock.mockReturnValue({
      rootStep: RootStep.document,
      stage: Stage.authenticated,
    })
    const { default: StepProgress } = await import("./step-progress")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<StepProgress />))
      expect(container.textContent).toContain("Step 5 / 8")
      expect(container.textContent).not.toContain("すべて完了")
      expect(
        container.querySelector('li[aria-current="step"]')?.textContent,
      ).toContain("書類の準備")
      const labels = Array.from(container.querySelectorAll("li"), (item) =>
        item.getAttribute("aria-label"),
      )
      expect(
        labels.slice(0, 4).every((label) => label?.endsWith("、完了")),
      ).toBe(true)
      expect(
        labels.slice(5).every((label) => label?.endsWith("、未着手")),
      ).toBe(true)
    } finally {
      await act(async () => root.unmount())
    }
  })

  it.each([
    RootStep.document,
    RootStep.result,
    RootStep.survey,
    RootStep.thanks,
  ])(
    "hides the step list in follow-up flow even on the first local preparation: %s",
    async (rootStep) => {
      useAppContextMock.mockReturnValue({
        rootStep,
        stage: Stage.followUp,
      })
      const { default: StepProgress } = await import("./step-progress")
      const root = createRoot(container)
      try {
        await act(async () => root.render(<StepProgress />))
        expect(container.textContent).toContain("Follow up Session")
        expect(container.textContent).toContain(
          "繰り返し解析を行うことができます。",
        )
        expect(container.textContent).not.toContain("すべて完了")
        expect(container.querySelector("ol")).toBeNull()
        expect(container.querySelector("[aria-current]")).toBeNull()
        expect(container.querySelector("button[aria-expanded]")).toBeNull()
      } finally {
        await act(async () => root.unmount())
      }
    },
  )

  it("does not show the step flow view after withdrawal", async () => {
    useAppContextMock.mockReturnValue({
      rootStep: RootStep.withdrawn,
      stage: Stage.withdrawn,
    })

    const { default: StepProgress } = await import("./step-progress")
    const root = createRoot(container)

    await act(async () => {
      root.render(<StepProgress />)
    })

    expect(
      container.querySelector('nav[aria-label="進行中のステップ"]'),
    ).toBeNull()
    expect(container.textContent).not.toContain("進行状況")
  })

  it("shows all steps initially and can collapse and reopen them without changing the current step", async () => {
    useAppContextMock.mockReturnValue({
      rootStep: RootStep.document,
      stage: Stage.authenticated,
    })

    const { default: StepProgress } = await import("./step-progress")
    const root = createRoot(container)
    await act(async () => {
      root.render(<StepProgress />)
    })

    const toggle = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )
    const steps = container.querySelector("ol")
    expect(toggle?.getAttribute("aria-expanded")).toBe("true")
    expect(toggle?.getAttribute("aria-controls")).toBe(steps?.id)
    expect(toggle?.textContent).toBe("全ステップを閉じる")
    expect(steps?.querySelectorAll("li")).toHaveLength(8)
    expect(
      steps?.querySelector('[aria-current="step"]')?.textContent,
    ).toContain("書類の準備")

    await act(async () => {
      toggle?.click()
    })
    expect(toggle?.getAttribute("aria-expanded")).toBe("false")
    expect(toggle?.textContent).toBe("全ステップを表示")

    await act(async () => {
      toggle?.click()
    })
    expect(toggle?.getAttribute("aria-expanded")).toBe("true")
    expect(toggle?.textContent).toBe("全ステップを閉じる")
    expect(
      steps?.querySelector('[aria-current="step"]')?.textContent,
    ).toContain("書類の準備")
    await act(async () => root.unmount())
  })

  it("shows and triggers the reshow button when dismissed messages exist", async () => {
    const resetDismissedInformationMessagesMock = vi.fn(async () => {})

    useAppContextMock.mockReturnValue({
      rootStep: RootStep.document,
      stage: Stage.authenticated,
    })
    useMessageContextMock.mockReturnValue({
      dismissedInformationMessageIds: ["info-1"],
      resetDismissedInformationMessages: resetDismissedInformationMessagesMock,
    })

    const { default: StepProgress } = await import("./step-progress")
    const root = createRoot(container)

    await act(async () => {
      root.render(<StepProgress />)
    })

    const reshowButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("メッセージを再表示"),
    )

    expect(reshowButton).not.toBeUndefined()

    await act(async () => {
      reshowButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(resetDismissedInformationMessagesMock).toHaveBeenCalledTimes(1)
  })
})
