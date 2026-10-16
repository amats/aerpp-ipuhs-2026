/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const moveToExplanationMock = vi.fn()
const updateStatusMock = vi.fn()
const useAppContextMock = vi.fn()

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => useAppContextMock(),
}))

vi.mock("@/assets/welcome.mdx", () => ({
  default: () => <div>welcome</div>,
}))

vi.mock("@/ui/card-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/rich-text-block", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

describe("SectionStart", () => {
  let container: HTMLDivElement

  function getOnlyButton() {
    const buttons = container.querySelectorAll("button")

    expect(buttons).toHaveLength(1)

    return buttons[0] ?? null
  }

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    moveToExplanationMock.mockReset()
    moveToExplanationMock.mockResolvedValue({ ok: true })
    updateStatusMock.mockReset()
    useAppContextMock.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  function createDeferred() {
    let resolve!: (value: { ok: true }) => void
    const promise = new Promise<{ ok: true }>((promiseResolve) => {
      resolve = promiseResolve
    })

    return { promise, resolve }
  }

  it("moves to explanation", async () => {
    useAppContextMock.mockReturnValue({
      moveToExplanation: moveToExplanationMock,
      updateStatusMessage: updateStatusMock,
    })

    const { default: SectionStart } = await import("./section-start")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionStart />)
    })

    await act(async () => {
      getOnlyButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(moveToExplanationMock).toHaveBeenCalled()
  })

  it("shows a moving state while moving to explanation", async () => {
    const deferred = createDeferred()
    moveToExplanationMock.mockReturnValueOnce(deferred.promise)
    useAppContextMock.mockReturnValue({
      moveToExplanation: moveToExplanationMock,
      updateStatusMessage: updateStatusMock,
    })

    const { default: SectionStart } = await import("./section-start")
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionStart />)
    })

    const button = getOnlyButton() as HTMLButtonElement

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe("移動中...")

    await act(async () => {
      deferred.resolve({ ok: true })
      await deferred.promise
    })

    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe("次に進む")
  })
})
