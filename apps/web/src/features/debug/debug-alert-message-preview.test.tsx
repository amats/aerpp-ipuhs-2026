/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/ui/card-panel", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

describe("DebugAlertMessagePreview", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("dismisses and restores the standard preview alerts", async () => {
    const { default: DebugAlertMessagePreview } = await import(
      "./debug-alert-message-preview"
    )
    const root = createRoot(container)

    await act(async () => {
      root.render(<DebugAlertMessagePreview />)
    })

    const sections = container.querySelectorAll("section")
    const dismissButtons = Array.from(
      container.querySelectorAll('button[aria-label="閉じる"]'),
    )
    const standardSection = sections[0]

    expect(container.textContent).toContain("Info:")
    expect(dismissButtons.length).toBeGreaterThan(0)
    expect(standardSection?.textContent).toContain("Info:")

    await act(async () => {
      dismissButtons[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(standardSection?.textContent).not.toContain("Info:")
    expect(standardSection?.textContent).toContain(
      "Standard セクションの alert は閉じられました。",
    )

    const resetButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "再表示",
    )

    expect(resetButton).toBeTruthy()

    await act(async () => {
      resetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(standardSection?.textContent).toContain("Info:")
  })
})
