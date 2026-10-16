/** @vitest-environment jsdom */

import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import { isValidStepState } from "@/features/app-context/step-state-validation"

const { status, cancel } = vi.hoisted(() => ({
  status: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock("./actions-reception", () => ({ getReceptionStatusAction: status }))
vi.mock("@/lib/tab-cancellation", () => ({ cancelTabOperations: cancel }))

import ReceptionBoundary from "./reception-boundary"

let element: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  status.mockReset().mockResolvedValue({ remainingMs: 1000 })
  cancel.mockClear()
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  localStorage.setItem("synthetic-result", "retained")
})
afterEach(async () => {
  await act(async () => root.unmount())
  element.remove()
  localStorage.clear()
  vi.useRealTimers()
})

const states = Object.values(Stage).flatMap((stage) =>
  Object.values(RootStep)
    .map((step) => ({ stage, step }))
    .filter(isValidStepState),
)
it.each(states)(
  "replaces $stage/$step at the cutoff without clearing stored data",
  async ({ stage, step }) => {
    const stop = vi.fn()
    function Flow() {
      useEffect(() => stop, [])
      return (
        <p>
          {stage}/{step}
        </p>
      )
    }
    await act(async () =>
      root.render(
        <ReceptionBoundary
          contactEmail="support@example.invalid"
          remainingMs={1000}
        >
          <Flow />
        </ReceptionBoundary>,
      ),
    )
    expect(element.textContent).toContain(`${stage}/${step}`)
    await act(async () => vi.advanceTimersByTime(999))
    expect(stop).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(element.querySelector("h1")?.textContent).toBe("受付は終了しました")
    expect(document.activeElement).toBe(element.querySelector("h1"))
    expect(element.querySelector("a")?.getAttribute("href")).toBe(
      "mailto:support@example.invalid",
    )
    expect(stop).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalled()
    expect(localStorage.getItem("synthetic-result")).toBe("retained")
  },
)

it("never mounts participation when loading after the cutoff", async () => {
  const mount = vi.fn()
  function Flow() {
    mount()
    return <p>参加画面</p>
  }
  await act(async () =>
    root.render(
      <ReceptionBoundary contactEmail="support@example.invalid" remainingMs={0}>
        <Flow />
      </ReceptionBoundary>,
    ),
  )
  expect(mount).not.toHaveBeenCalled()
  expect(status).not.toHaveBeenCalled()
  expect(element.textContent).toContain("受付は終了しました")
})

it("rechecks the server on focus after browser suspension", async () => {
  await act(async () =>
    root.render(
      <ReceptionBoundary
        contactEmail="support@example.invalid"
        remainingMs={1000}
      >
        <p>参加画面</p>
      </ReceptionBoundary>,
    ),
  )
  status.mockResolvedValue({ remainingMs: 0 })
  await act(async () => window.dispatchEvent(new Event("focus")))
  expect(element.textContent).toContain("受付は終了しました")
})

it("keeps the known deadline when a status request fails", async () => {
  status.mockRejectedValue(new Error("offline"))
  await act(async () =>
    root.render(
      <ReceptionBoundary
        contactEmail="support@example.invalid"
        remainingMs={1000}
      >
        <p>参加画面</p>
      </ReceptionBoundary>,
    ),
  )
  await act(async () => vi.advanceTimersByTime(1000))
  expect(element.textContent).toContain("受付は終了しました")
})

it("does not close early when the status request waits before reaching the server", async () => {
  const response = Promise.withResolvers<{ remainingMs: number }>()
  status.mockReturnValue(response.promise)
  await act(async () =>
    root.render(
      <ReceptionBoundary
        contactEmail="support@example.invalid"
        remainingMs={60_000}
      >
        <p>参加画面</p>
      </ReceptionBoundary>,
    ),
  )
  await act(async () => vi.advanceTimersByTime(30_000))
  await act(async () => response.resolve({ remainingMs: 30_000 }))
  expect(element.textContent).toContain("参加画面")
  expect(cancel).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(29_999))
  expect(element.textContent).toContain("参加画面")
  await act(async () => vi.advanceTimersByTime(1))
  expect(element.textContent).toContain("受付は終了しました")
  expect(cancel).toHaveBeenCalled()
})

it("does not extend the known deadline when an older response arrives late", async () => {
  const older = Promise.withResolvers<{ remainingMs: number }>()
  status.mockReturnValueOnce(older.promise)
  await act(async () =>
    root.render(
      <ReceptionBoundary
        contactEmail="support@example.invalid"
        remainingMs={60_000}
      >
        <p>参加画面</p>
      </ReceptionBoundary>,
    ),
  )
  await act(async () => vi.advanceTimersByTime(30_000))
  status.mockResolvedValueOnce({ remainingMs: 30_000 })
  await act(async () => window.dispatchEvent(new Event("focus")))
  await act(async () => vi.advanceTimersByTime(20_000))
  await act(async () => older.resolve({ remainingMs: 60_000 }))
  expect(element.textContent).toContain("参加画面")
  await act(async () => vi.advanceTimersByTime(10_000))
  expect(element.textContent).toContain("受付は終了しました")
})

it("closes at the known deadline even while a status request is pending", async () => {
  const response = Promise.withResolvers<{ remainingMs: number }>()
  status.mockReturnValue(response.promise)
  await act(async () =>
    root.render(
      <ReceptionBoundary
        contactEmail="support@example.invalid"
        remainingMs={1000}
      >
        <p>参加画面</p>
      </ReceptionBoundary>,
    ),
  )
  await act(async () => vi.advanceTimersByTime(1000))
  expect(element.textContent).toContain("受付は終了しました")
  await act(async () => response.resolve({ remainingMs: 1000 }))
  expect(element.textContent).toContain("受付は終了しました")
})
