/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  activateTabOperations,
  cancelTabOperations,
  isTabOperationCurrent,
} from "@/lib/tab-cancellation"
import { getTabToken, setTabToken } from "@/lib/tab-token"
import {
  acknowledgeAnalysisResult,
  requestAnalysisJob,
} from "./analysis-job-client"
import { ANALYSIS_JOB_CONSTRAINTS as limits } from "./analysis-job-constraints"

const fetchMock = vi.fn()
beforeEach(() => {
  localStorage.clear()
  activateTabOperations("synthetic")
  setTabToken("synthetic")
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, "timeout").mockImplementation((duration) => {
    const controller = new AbortController()
    setTimeout(
      () => controller.abort(new DOMException("Timeout", "TimeoutError")),
      duration,
    )
    return controller.signal
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it.each(["caller", "timeout"])(
  "ignores a late stale-state response after %s cancellation without invalidating the tab",
  async (condition) => {
    const body = Promise.withResolvers<unknown>()
    const reading = Promise.withResolvers<void>()
    fetchMock.mockResolvedValue({
      ok: false,
      headers: new Headers(),
      json: () => {
        reading.resolve()
        return body.promise
      },
    })
    const controller = new AbortController()
    const rejected = expect(
      requestAnalysisJob({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
    await reading.promise
    if (condition === "caller") controller.abort()
    else await vi.advanceTimersByTimeAsync(limits.requestTimeoutMs)
    body.resolve({ ok: false, reason: "stale_session_state" })
    await rejected
    expect(isTabOperationCurrent()).toBe(true)
    expect(getTabToken()).toBe("synthetic")
  },
)

it("does not adopt a token from an aborted analysis response", async () => {
  const controller = new AbortController()
  fetchMock.mockResolvedValue({
    ok: true,
    headers: new Headers({ "x-aerpp-session-token": "replacement" }),
    json: async () => {
      controller.abort()
      return { ok: true, status: "idle", analysisId: null }
    },
  })
  await expect(
    requestAnalysisJob({ signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" })
  expect(getTabToken()).toBe("synthetic")
  expect(isTabOperationCurrent()).toBe(true)
})

it("bounds acknowledgement transport and does not adopt late cleanup tokens", async () => {
  fetchMock.mockResolvedValue(
    new Response(null, {
      status: 204,
      headers: { "x-aerpp-session-token": "replacement" },
    }),
  )
  await acknowledgeAnalysisResult("analysis-1")
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/llm/analysis/result?analysisId=analysis-1",
    expect.objectContaining({ method: "DELETE", cache: "no-store" }),
  )
  expect(getTabToken()).toBe("synthetic")
})
it.each(["timeout", "revocation"])(
  "aborts stalled acknowledgement after %s",
  async (condition) => {
    fetchMock.mockImplementation(
      (_url, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        ),
    )
    const rejected = expect(
      acknowledgeAnalysisResult("analysis-1"),
    ).rejects.toBeDefined()
    if (condition === "timeout")
      await vi.advanceTimersByTimeAsync(limits.requestTimeoutMs)
    else cancelTabOperations()
    await rejected
  },
)
