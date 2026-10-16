/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

const resetMock = vi.fn()
const updateStatusMock = vi.fn()
vi.mock("./app-context-provider", () => ({
  useAppContext: () => ({ resetToStart: resetMock }),
}))
vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({ updateStatusMessage: updateStatusMock }),
}))

const { useResetToStart } = await import("./use-reset-to-start")

describe("reset failure feedback", () => {
  it.each([
    "success",
    "rejected",
    "exception",
    "result_clear_failed",
    "session_busy",
  ])("handles %s without an unhandled rejection", async (outcome) => {
    vi.clearAllMocks()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    if (outcome === "exception")
      resetMock.mockRejectedValueOnce(new Error("offline"))
    else
      resetMock.mockResolvedValueOnce({
        ok: outcome === "success",
        reason: outcome === "rejected" ? "step_state_write_failed" : outcome,
      })
    let reset!: ReturnType<typeof useResetToStart>
    function Probe() {
      reset = useResetToStart()
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(<Probe />))
    await act(async () => reset())
    if (outcome === "success") expect(updateStatusMock).not.toHaveBeenCalled()
    else if (outcome === "result_clear_failed") {
      expect(updateStatusMock).toHaveBeenCalledWith({
        message: expect.stringContaining("初期状態に戻りましたが"),
        tone: "warning",
        recovery: "reload",
      })
    } else if (outcome === "session_busy") {
      expect(updateStatusMock).toHaveBeenCalledWith({
        message: expect.stringContaining("別の処理が進行中"),
        tone: "warning",
      })
    } else
      expect(updateStatusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: "error",
          message: expect.stringContaining("初期状態に戻せませんでした"),
        }),
      )
    await act(async () => root.unmount())
  })
})
