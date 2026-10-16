/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const useAppContextMock = vi.fn()
const useMessageContextMock = vi.fn()

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => useAppContextMock(),
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => useMessageContextMock(),
}))

vi.mock("@/ui/card-panel", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

describe("DebugClientPanel", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    useAppContextMock.mockReset()
    useMessageContextMock.mockReset()
    useAppContextMock.mockReturnValue({
      stage: "authenticated",
      stepState: {
        stage: "authenticated",
        step: "document",
      },
    })
    useMessageContextMock.mockReturnValue({
      statusMessage: {
        message: "ok",
        tone: "success",
      },
      dismissedInformationMessageIds: ["info-1"],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ""
  })

  it("shows app context and localStorage values", async () => {
    window.localStorage.setItem(
      "aerpp:dismissed-information-message-ids",
      JSON.stringify(["info-1"]),
    )

    const { default: DebugClientPanel } = await import("./debug-client-panel")
    const root = createRoot(container)

    await act(async () => {
      root.render(<DebugClientPanel />)
    })

    expect(container.textContent).toContain('"stage": "authenticated"')
    expect(container.textContent).toContain('"appContext": {')
    expect(container.textContent).toContain(
      '"dismissedInformationMessageIds": [',
    )
    expect(container.textContent).toContain('"info-1"')
    expect(container.textContent).toContain(
      '"aerpp:dismissed-information-message-ids":',
    )
  })
  it("reports unavailable storage without hiding the debug panel", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    const { default: Panel } = await import("./debug-client-panel")
    const root = createRoot(container)
    await act(async () => root.render(<Panel />))
    expect(container.textContent).toContain('"status": "unavailable"')
    expect(container.textContent).toContain('"appContext": {')
    await act(async () => root.unmount())
  })
})
