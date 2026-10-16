/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest"

it("keeps storage and focus refresh usable when optional notifications fail", async () => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      constructor() {
        throw new Error("Channel unavailable")
      }
    },
  )
  const { changeBrowserState, subscribeBrowserState } = await import(
    "./browser-database"
  )
  const failed = subscribeBrowserState(() => {
    throw new Error("View unavailable")
  })
  const notified = vi.fn()
  const unsubscribe = subscribeBrowserState(notified)
  try {
    await expect(
      changeBrowserState(() => ({ value: true, changed: false })),
    ).resolves.toBe(true)
    expect(notified).toHaveBeenCalledOnce()
    notified.mockClear()
    window.dispatchEvent(new Event("focus"))
    await vi.waitFor(() => expect(notified).toHaveBeenCalledOnce())
  } finally {
    failed()
    unsubscribe()
    vi.unstubAllGlobals()
  }
})
