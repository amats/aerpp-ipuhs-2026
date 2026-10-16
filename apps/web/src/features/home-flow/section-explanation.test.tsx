/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const moveToConsentMock = vi.fn()
const useAppContextMock = vi.fn()

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => useAppContextMock(),
}))

vi.mock("@/assets/explanation.mdx", () => ({
  default: () => <div>explanation</div>,
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

function createDeferred() {
  let resolve!: (value: { ok: true }) => void
  const promise = new Promise<{ ok: true }>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe("SectionExplanation", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    moveToConsentMock.mockReset()
    moveToConsentMock.mockResolvedValue({ ok: true })
    useAppContextMock.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("moves to consent", async () => {
    useAppContextMock.mockReturnValue({
      moveToConsent: moveToConsentMock,
    })

    const { default: SectionExplanation } = await import(
      "./section-explanation"
    )
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionExplanation />)
    })

    await act(async () => {
      container
        .querySelectorAll("button")[1]
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(moveToConsentMock).toHaveBeenCalled()
  })

  it("shows a moving state while moving to consent", async () => {
    const deferred = createDeferred()
    moveToConsentMock.mockReturnValueOnce(deferred.promise)
    useAppContextMock.mockReturnValue({
      moveToConsent: moveToConsentMock,
    })

    const { default: SectionExplanation } = await import(
      "./section-explanation"
    )
    const root = createRoot(container)

    await act(async () => {
      root.render(<SectionExplanation />)
    })

    const button = container.querySelectorAll("button")[1] as HTMLButtonElement

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
    expect(button.textContent).toBe("同意画面へ進む")
  })
})
