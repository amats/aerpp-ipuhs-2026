/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { AppContextState } from "@/features/app-context/app-context-types"
import WithdrawalCleanupPanel from "./withdrawal-cleanup-panel"

const context = vi.hoisted(() => ({
  completeWithdrawal: vi.fn(),
  readWithdrawalCleanup: vi.fn(),
  sessionAdmission: "unavailable" as AppContextState["sessionAdmission"],
  withdrawalCleanupStatus:
    "unconfirmed" as AppContextState["withdrawalCleanupStatus"],
}))
vi.mock("@/features/app-context/app-context-provider", () => ({
  useAppContext: () => context,
}))

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  context.completeWithdrawal.mockReset()
  context.readWithdrawalCleanup.mockReset()
  context.sessionAdmission = "unavailable"
  context.withdrawalCleanupStatus = "unconfirmed"
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
  container.remove()
})

it("checks without email on mount, retries after 30 seconds, and stops on completion", async () => {
  context.completeWithdrawal
    .mockResolvedValueOnce({ ok: true, cleanupPending: true })
    .mockResolvedValue({ ok: true, resultCleared: true })
  await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
  expect(context.completeWithdrawal).toHaveBeenCalledWith()
  await act(async () => vi.advanceTimersByTimeAsync(29_999))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(2)
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(2)
})

it("does not overlap requests or keep checking after leaving the page", async () => {
  const pending = Promise.withResolvers<{ ok: true; cleanupPending: true }>()
  context.completeWithdrawal.mockReturnValue(pending.promise)
  await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
  expect(container.querySelector("button")?.disabled).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(1)
  await act(async () => root.render(null))
  await act(async () => pending.resolve({ ok: true, cleanupPending: true }))
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(1)
})

it.each(["complete", "localFailed"] as const)(
  "does not automatically repeat %s",
  async (status) => {
    context.withdrawalCleanupStatus = status
    await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
    await act(async () => vi.advanceTimersByTimeAsync(90_000))
    expect(context.completeWithdrawal).not.toHaveBeenCalled()
  },
)

it("offers a manual retry after a network failure without waiting for the timer", async () => {
  context.completeWithdrawal
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ok: true, resultCleared: true })
  await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
  expect(container.textContent).toContain("消去状態を確認できませんでした")
  expect(container.querySelector("button")?.textContent).toBe(
    "データ削除の再試行",
  )
  await act(async () => container.querySelector("button")?.click())
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(2)
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(2)
})

it("retries local deletion explicitly without automatically repeating it", async () => {
  context.withdrawalCleanupStatus = "localFailed"
  context.completeWithdrawal.mockResolvedValue({
    ok: true,
    resultCleared: true,
  })
  await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).not.toHaveBeenCalled()
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "データ削除の再試行",
  )
  await act(async () => retry?.click())
  expect(context.completeWithdrawal).toHaveBeenCalledOnce()
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).toHaveBeenCalledOnce()
})

it("keeps local deletion retries manual even when the explicit retry cannot confirm cleanup", async () => {
  context.withdrawalCleanupStatus = "localFailed"
  context.completeWithdrawal.mockRejectedValue(new Error("offline"))
  await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "データ削除の再試行",
  )
  await act(async () => retry?.click())
  expect(container.textContent).not.toContain("自動で再試行します")
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).toHaveBeenCalledOnce()
})

it("only reads saved state on the withdrawal form and never schedules automatic retries", async () => {
  context.readWithdrawalCleanup.mockResolvedValue({
    ok: true,
    cleanupPending: true,
  })
  context.completeWithdrawal.mockResolvedValue({
    ok: true,
    cleanupPending: true,
  })
  await act(async () => root.render(<WithdrawalCleanupPanel />))
  expect(context.readWithdrawalCleanup).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).not.toHaveBeenCalled()
  await act(async () => container.querySelector("button")?.click())
  expect(context.completeWithdrawal).toHaveBeenCalledWith()
  await act(async () => vi.advanceTimersByTimeAsync(90_000))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(1)
  expect(context.readWithdrawalCleanup).toHaveBeenCalledTimes(1)
})

it("waits for session selection before checking after reload", async () => {
  context.sessionAdmission = "checking"
  context.completeWithdrawal.mockResolvedValue({
    ok: true,
    resultCleared: true,
  })
  await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
  expect(context.completeWithdrawal).not.toHaveBeenCalled()
  context.sessionAdmission = "unavailable"
  await act(async () => root.render(<WithdrawalCleanupPanel autoRefresh />))
  expect(context.completeWithdrawal).toHaveBeenCalledTimes(1)
})
