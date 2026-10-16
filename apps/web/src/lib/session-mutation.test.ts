/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest"
import { guardSessionMutation, runSessionMutation } from "./session-mutation"
import { activateTabOperations } from "./tab-cancellation"

afterEach(() => vi.unstubAllGlobals())
it("permits tabs to submit operations independently of browser locks", async () => {
  activateTabOperations("synthetic")
  const request = vi.fn().mockRejectedValue(new Error("unused"))
  vi.stubGlobal("navigator", { locks: { request } })
  const first = Promise.withResolvers<void>()
  const waiting = runSessionMutation(async () => {
    await first.promise
    return { ok: true }
  })
  expect(await runSessionMutation(async () => ({ ok: true }))).toEqual({
    ok: true,
  })
  first.resolve()
  expect(await waiting).toEqual({ ok: true })
  expect(request).not.toHaveBeenCalled()
})
it("preserves inputs, failure results and a single attempt", async () => {
  activateTabOperations("synthetic")
  const operation = vi.fn(async (_value: string) => ({
    ok: false,
    reason: "upstream_failed",
  }))
  expect(await guardSessionMutation(operation)("input")).toEqual({
    ok: false,
    reason: "upstream_failed",
  })
  expect(operation).toHaveBeenCalledExactlyOnceWith("input")
})

it("announces a slow mutation without completing it or running it again", async () => {
  vi.useFakeTimers()
  const { isSessionMutationSlow } = await import("./session-mutation")
  activateTabOperations("synthetic")
  const deferred = Promise.withResolvers<{ ok: true }>()
  const operation = vi.fn(() => deferred.promise)
  const pending = runSessionMutation(operation)
  try {
    expect(isSessionMutationSlow()).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(isSessionMutationSlow()).toBe(true)
    expect(operation).toHaveBeenCalledOnce()
    deferred.resolve({ ok: true })
    expect(await pending).toEqual({ ok: true })
    expect(isSessionMutationSlow()).toBe(false)
  } finally {
    deferred.resolve({ ok: true })
    await pending
    vi.useRealTimers()
  }
})
