/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import {
  MessageContextProvider,
  useMessageContext,
} from "@/features/message/message-context-provider"
import ResetPage from "./reset-page"

const { clearCookiesMock, clearClientStateMock, locationAssignMock } =
  vi.hoisted(() => ({
    clearCookiesMock: vi.fn(async () => ({ ok: true })),
    clearClientStateMock: vi.fn(),
    locationAssignMock: vi.fn(),
  }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/reset",
}))
vi.mock("@/features/reset/actions-reset", () => ({
  resetSessionAction: clearCookiesMock,
}))
vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => ({ clearClientState: clearClientStateMock }),
}))

function Probe() {
  const { statusMessage, dismissedInformationMessageIds } = useMessageContext()
  return (
    <>
      <ResetPage />
      <p role="status">{statusMessage?.message}</p>
      <p data-testid="dismissed">{dismissedInformationMessageIds.join(",")}</p>
    </>
  )
}

it("clears stored results even when resetting display preferences cannot write to full storage", async () => {
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
  window.localStorage.clear()
  window.localStorage.setItem("aerpp:analysis-result", "sealed-result")
  window.sessionStorage.setItem("aerpp-survey-view", "previous-analysis")
  window.localStorage.setItem(
    "aerpp:dismissed-information-message-ids",
    JSON.stringify(["message-1"]),
  )
  const originalSetItem = Storage.prototype.setItem
  const setItemMock = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === "aerpp:dismissed-information-message-ids")
        throw new DOMException("quota", "QuotaExceededError")
      return originalSetItem.call(this, key, value)
    })
  const clearStorage = vi.spyOn(Storage.prototype, "clear")
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <MessageContextProvider>
          <Probe />
        </MessageContextProvider>,
      ),
    )
    expect(
      container.querySelector('[data-testid="dismissed"]')?.textContent,
    ).toBe("message-1")
    await act(async () => container.querySelector("button")?.click())
    expect(clearCookiesMock).toHaveBeenCalledTimes(1)
    expect(clearClientStateMock).toHaveBeenCalledTimes(1)
    expect(clearStorage).toHaveBeenCalledTimes(2)
    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.getItem("aerpp:analysis-result")).toBeNull()
    expect(locationAssignMock).toHaveBeenCalledWith("/")
    expect(setItemMock).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(
      container.querySelector('[data-testid="dismissed"]')?.textContent,
    ).toBe("")
    expect(container.querySelector('[role="status"]')?.textContent).toBe("")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  }
})

vi.mock("@/lib/browser-session", () => ({
  isBrowserResetCurrent: vi.fn(async () => true),
  beginBrowserReset: vi.fn(async () => ({
    scope: "11111111-1111-1111-1111-111111111111",
    attempt: "attempt",
  })),
  finishBrowserReset: vi.fn(async () => true),
  cancelBrowserReset: vi.fn(async () => {}),
}))
