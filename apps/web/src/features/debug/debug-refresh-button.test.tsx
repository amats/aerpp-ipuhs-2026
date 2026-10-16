/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const reloadDebugPageMock = vi.fn()

vi.mock("@/features/debug/debug-navigation", () => ({
  reloadDebugPage: reloadDebugPageMock,
}))

describe("DebugRefreshButton", () => {
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
    reloadDebugPageMock.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("reloads the page on click", async () => {
    const { default: DebugRefreshButton } = await import(
      "./debug-refresh-button"
    )
    const root = createRoot(container)

    await act(async () => {
      root.render(<DebugRefreshButton />)
    })

    await act(async () => {
      getOnlyButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(reloadDebugPageMock).toHaveBeenCalledTimes(1)
  })
})
