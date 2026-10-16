/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { cancelTabOperations } from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"
import { useSessionAdmission } from "./use-session-admission"

const { admit, status, isCurrent } = vi.hoisted(() => ({
  admit: vi.fn(),
  status: vi.fn(),
  isCurrent: vi.fn(),
}))
const scope = "22222222-2222-2222-2222-222222222222"
vi.mock("./actions-session", () => ({ admitSessionAction: admit }))
vi.mock("./session-status-client", () => ({ fetchSessionStatus: status }))
vi.mock("@/lib/browser-session", () => ({
  getBrowserSession: async () => scope,
  commitBrowserAdmission: async () => true,
  readBrowserRecoveryRevision: () => 0,
  isBrowserSessionCurrent: isCurrent,
}))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem("aerpp-tab-scope", scope)
  admit.mockReset().mockResolvedValue({
    ok: true,
    scope,
    sessionToken: `${scope}:${"a".repeat(64)}`,
    recovered: false,
    stepState: { stage: "unauthenticated", step: "start" },
  })
  status.mockReset()
  isCurrent.mockReset().mockReturnValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it("admits once and never sends awake or focus/status requests", async () => {
  vi.useFakeTimers()
  let hook!: ReturnType<typeof useSessionAdmission>
  function Probe() {
    hook = useSessionAdmission()
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    expect(hook.status).toBe("ready")
    expect(getTabToken()).toBe(`${scope}:${"a".repeat(64)}`)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(admit).toHaveBeenCalledOnce()
    expect(status).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})
it("reload admits the shared session without cancelling analysis", async () => {
  Object.defineProperty(performance, "getEntriesByType", {
    configurable: true,
    value: vi.fn(() => [{ type: "reload" }]),
  })
  sessionStorage.setItem("retained-browser-draft", scope)
  function Probe() {
    useSessionAdmission()
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    expect(admit).toHaveBeenCalledWith(scope)
    expect(sessionStorage.getItem("retained-browser-draft")).toBe(scope)
  } finally {
    await act(async () => root.unmount())
  }
})
it("preserves browser information on unavailable admission", async () => {
  admit.mockRejectedValueOnce(new Error("Synthetic transport failure"))
  localStorage.setItem("protected-result", "encrypted")
  let hook!: ReturnType<typeof useSessionAdmission>
  function Probe() {
    hook = useSessionAdmission()
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    expect(hook.status).toBe("unavailable")
    expect(hook.canRetryAdmission).toBe(true)
    expect(localStorage.getItem("protected-result")).toBe("encrypted")
    await act(async () => hook.retryAdmission())
    expect(hook.status).toBe("ready")
    expect(admit).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem("protected-result")).toBe("encrypted")
  } finally {
    await act(async () => root.unmount())
  }
})

it("requires reload after an admitted screen is invalidated instead of silently readmitting it", async () => {
  let hook!: ReturnType<typeof useSessionAdmission>
  const onCancelled = vi.fn()
  function Probe() {
    hook = useSessionAdmission(onCancelled)
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    localStorage.setItem("protected-result", "encrypted")
    await act(async () => cancelTabOperations())
    expect(hook.status).toBe("unavailable")
    expect(hook.canRetryAdmission).toBe(false)
    expect(onCancelled).toHaveBeenCalledOnce()
    await act(async () => hook.retryAdmission())
    expect(admit).toHaveBeenCalledOnce()
    expect(localStorage.getItem("protected-result")).toBe("encrypted")
  } finally {
    await act(async () => root.unmount())
  }
})

it("does not hang or adopt a response after another tab replaces the browser scope during admission", async () => {
  const pending = Promise.withResolvers<unknown>()
  admit.mockReturnValueOnce(pending.promise)
  let hook!: ReturnType<typeof useSessionAdmission>
  function Probe() {
    hook = useSessionAdmission()
    return null
  }
  const root = createRoot(document.createElement("div"))
  try {
    await act(async () => root.render(<Probe />))
    expect(hook.status).toBe("checking")
    localStorage.setItem("protected-result", "replacement-result")
    isCurrent.mockReturnValue(false)
    await act(async () => pending.resolve({ ok: true, recovered: true }))
    expect(hook.status).toBe("unavailable")
    expect(hook.canRetryAdmission).toBe(false)
    expect(localStorage.getItem("protected-result")).toBe("replacement-result")
  } finally {
    await act(async () => root.unmount())
  }
})
