/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const clearCookiesMock = vi.fn()
const clearStorageMock = vi.fn()
const clearDatabasesMock = vi.fn()
const isCurrentResetMock = vi.fn(async () => true)
const finishResetMock = vi.fn(async () => true)
const cancelResetMock = vi.fn(async () => {})
const locationAssignMock = vi.fn()
const updateStatusMock = vi.fn()
const clearClientStateMock = vi.fn()
const clearClientMessagesMock = vi.fn()

vi.mock("@/features/reset/actions-reset", () => ({
  resetSessionAction: clearCookiesMock,
}))

vi.mock("@/lib/browser-storage", () => ({
  clearOriginLocalStorage: clearStorageMock,
  clearOriginBrowserDatabases: clearDatabasesMock,
}))

vi.mock("@/features/message/message-context-provider", () => ({
  useMessageContext: () => ({
    clearClientMessages: clearClientMessagesMock,
    updateStatusMessage: updateStatusMock,
  }),
}))

vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => ({ clearClientState: clearClientStateMock }),
}))

vi.mock("@/ui/card-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

vi.mock("@/ui/section-heading", () => ({
  default: ({ title }: { title?: string }) => <div>{title}</div>,
}))

describe("ResetPage", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      "window",
      new Proxy(window, {
        get(target, key) {
          return key === "location"
            ? { assign: locationAssignMock }
            : Reflect.get(target, key, target)
        },
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ""
  })

  async function clickReset() {
    const button = container.querySelector("button") as HTMLButtonElement
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }

  it("offers browser reset without a server-history deletion control", async () => {
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))
    expect(container.querySelector("input[type=email]")).toBeNull()
    expect(container.textContent).not.toContain("サーバー履歴も完全消去")
    await act(async () => root.unmount())
  })

  it("force resets even while another tab holds the browser operation lock", async () => {
    clearCookiesMock.mockResolvedValue({ ok: true })
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn(async (_name, _options, callback) => callback(null)),
      },
    })
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))
    await clickReset()
    expect(navigator.locks.request).not.toHaveBeenCalled()
    expect(clearCookiesMock).toHaveBeenCalledTimes(1)
    expect(clearStorageMock).toHaveBeenCalledTimes(1)
    expect(clearClientStateMock).toHaveBeenCalledTimes(1)
    expect(locationAssignMock).toHaveBeenCalledWith("/")
    expect(updateStatusMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it("clears browser storage only after cookies were deleted", async () => {
    clearCookiesMock.mockResolvedValue({ ok: true })
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))

    await clickReset()

    expect(clearCookiesMock).toHaveBeenCalledTimes(1)
    expect(clearStorageMock).toHaveBeenCalledTimes(1)
    expect(clearClientStateMock).toHaveBeenCalledTimes(1)
    expect(clearClientMessagesMock).toHaveBeenCalledTimes(1)
    expect(finishResetMock.mock.invocationCallOrder[0]).toBeLessThan(
      clearDatabasesMock.mock.invocationCallOrder[0],
    )
    expect(clearCookiesMock.mock.invocationCallOrder[0]).toBeLessThan(
      finishResetMock.mock.invocationCallOrder[0],
    )
    expect(locationAssignMock).toHaveBeenCalledWith("/")
  })

  it("keeps all browser stores when another reset supersedes a delayed response", async () => {
    clearCookiesMock.mockResolvedValue({ ok: true })
    isCurrentResetMock.mockResolvedValueOnce(false)
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))
    await clickReset()
    expect(clearDatabasesMock).not.toHaveBeenCalled()
    expect(clearStorageMock).not.toHaveBeenCalled()
    expect(clearClientStateMock).not.toHaveBeenCalled()
    expect(locationAssignMock).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it.each([
    "success",
    "cookie_failure",
    "transport_failure",
    "storage_failure",
  ])(
    "preserves the selected page and its notice after leaving during reset: %s",
    async (outcome) => {
      const pending = Promise.withResolvers<unknown>()
      clearCookiesMock.mockReturnValueOnce(pending.promise)
      if (outcome === "storage_failure") {
        clearStorageMock.mockImplementationOnce(() => {
          throw new DOMException("Storage blocked", "SecurityError")
        })
      }
      const { default: ResetPage } = await import("./reset-page")
      const root = createRoot(container)
      await act(async () => root.render(<ResetPage />))
      await clickReset()
      expect(clearCookiesMock).toHaveBeenCalledTimes(1)
      expect(clearClientStateMock).not.toHaveBeenCalled()
      expect(clearStorageMock).not.toHaveBeenCalled()
      await act(async () => root.render(<div>Selected page with a notice</div>))
      await act(async () => {
        if (outcome === "transport_failure") {
          pending.reject(new TypeError("Failed to fetch"))
        } else {
          pending.resolve(
            outcome === "cookie_failure"
              ? { ok: false, reason: "cookie_clear_failed" }
              : { ok: true },
          )
        }
      })

      expect(container.textContent).toBe("Selected page with a notice")
      expect(locationAssignMock).not.toHaveBeenCalled()
      expect(updateStatusMock).not.toHaveBeenCalled()
      const cookiesCleared =
        outcome === "success" || outcome === "storage_failure"
      expect(clearClientStateMock).toHaveBeenCalledTimes(
        outcome === "success" ? 1 : 0,
      )
      expect(clearStorageMock).toHaveBeenCalledTimes(cookiesCleared ? 1 : 0)
      if (outcome === "success") {
        expect(clearClientMessagesMock).toHaveBeenCalledWith({
          preserveStatusMessage: true,
        })
      } else {
        expect(clearClientMessagesMock).not.toHaveBeenCalled()
      }
      await act(async () => root.unmount())
    },
  )

  it("reports storage deletion failure and allows retry without claiming completion", async () => {
    clearCookiesMock.mockResolvedValue({ ok: true })
    clearStorageMock.mockImplementationOnce(() => {
      throw new DOMException("Storage blocked", "SecurityError")
    })
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))
    await clickReset()
    expect(locationAssignMock).not.toHaveBeenCalled()
    expect(clearClientMessagesMock).not.toHaveBeenCalled()
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    )
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    )
    await clickReset()
    expect(locationAssignMock).toHaveBeenCalledWith("/")
    expect(clearClientMessagesMock).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it("does not navigate or claim completion when database deletion fails", async () => {
    clearCookiesMock.mockResolvedValue({ ok: true })
    clearDatabasesMock.mockRejectedValueOnce(new Error("Deletion blocked"))
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))
    await clickReset()
    expect(locationAssignMock).not.toHaveBeenCalled()
    expect(clearClientMessagesMock).not.toHaveBeenCalled()
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    )
    expect(cancelResetMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    )
    await clickReset()
    expect(locationAssignMock).toHaveBeenCalledWith("/")
    await act(async () => root.unmount())
  })

  it("cancels the unfinished reset when its final transaction fails", async () => {
    clearCookiesMock.mockResolvedValue({ ok: true })
    finishResetMock.mockRejectedValueOnce(new Error("Transaction aborted"))
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))
    await clickReset()
    expect(cancelResetMock).toHaveBeenCalledOnce()
    expect(clearDatabasesMock).not.toHaveBeenCalled()
    expect(clearStorageMock).not.toHaveBeenCalled()
    expect(locationAssignMock).not.toHaveBeenCalled()
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    )
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    )
    await act(async () => root.unmount())
  })

  it("keeps browser storage and reports an error when cookie deletion fails", async () => {
    clearCookiesMock.mockResolvedValue({
      ok: false,
      reason: "cookie_clear_failed",
    })
    const { default: ResetPage } = await import("./reset-page")
    const root = createRoot(container)
    await act(async () => root.render(<ResetPage />))

    await clickReset()

    expect(clearStorageMock).not.toHaveBeenCalled()
    expect(cancelResetMock).toHaveBeenCalledOnce()
    expect(clearClientStateMock).not.toHaveBeenCalled()
    expect(clearClientMessagesMock).not.toHaveBeenCalled()
    expect(locationAssignMock).not.toHaveBeenCalled()
    expect(updateStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error" }),
    )
  })
})

vi.mock("@/lib/browser-session", () => ({
  isBrowserResetCurrent: isCurrentResetMock,
  beginBrowserReset: vi.fn(async () => ({
    scope: "11111111-1111-1111-1111-111111111111",
    replacementScope: "22222222-2222-2222-2222-222222222222",
    attempt: "attempt",
  })),
  finishBrowserReset: finishResetMock,
  cancelBrowserReset: cancelResetMock,
}))
