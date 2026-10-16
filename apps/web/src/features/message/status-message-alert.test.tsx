/** @vitest-environment jsdom */

import { act, type ReactNode, type Ref } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const useMessageContextMock = vi.fn()
const alertMessageMock = vi.fn(
  ({
    children,
    tone,
  }: {
    children: ReactNode
    tone?: "info" | "success" | "error"
  }) => (
    <div>
      {tone}:{children}
    </div>
  ),
)

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => useMessageContextMock(),
}))

vi.mock("@/ui/alert-message", () => ({
  default: function MockAlertMessage(props: {
    children: ReactNode
    tone?: "info" | "success" | "error"
    ref?: Ref<HTMLElement>
  }) {
    return alertMessageMock(props)
  },
}))

describe("StatusMessageAlert", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useMessageContextMock.mockReset()
    alertMessageMock.mockClear()
  })

  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("renders nothing when there is no status message", async () => {
    useMessageContextMock.mockReturnValue({
      statusMessage: null,
    })

    const { default: StatusMessageAlert } = await import(
      "./status-message-alert"
    )
    const root = createRoot(container)

    await act(async () => {
      root.render(<StatusMessageAlert />)
    })

    expect(container.innerHTML).toBe("")
    expect(alertMessageMock).not.toHaveBeenCalled()
  })

  it("offers reload guidance for recovery messages", async () => {
    useMessageContextMock.mockReturnValue({
      statusMessage: {
        message: "Local cleanup failed",
        tone: "error",
        recovery: "reload",
      },
    })
    const { default: StatusMessageAlert } = await import(
      "./status-message-alert"
    )
    const root = createRoot(container)
    await act(async () => root.render(<StatusMessageAlert />))
    const link = container.querySelector("button")
    expect(link?.textContent).toBe("ページを再読み込み")
    await act(async () => root.unmount())
  })

  it("passes the message and default tone to AlertMessage", async () => {
    useMessageContextMock.mockReturnValue({
      statusMessage: {
        message: "Saved",
      },
    })

    const { default: StatusMessageAlert } = await import(
      "./status-message-alert"
    )
    const root = createRoot(container)

    await act(async () => {
      root.render(<StatusMessageAlert />)
    })

    expect(alertMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        children: "Saved",
        tone: "info",
      }),
    )
    expect(container.textContent).toBe("info:Saved")
  })
})
