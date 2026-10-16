import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ANALYSIS_JOB_CONSTRAINTS as limits } from "./analysis-job-constraints"

const { request, seal, watches, version } = vi.hoisted(() => ({
  request: vi.fn(),
  seal: vi.fn(),
  watches: [] as AbortController[],
  version: { current: "1.0.0" },
}))
vi.mock("@/lib/version", () => ({
  get APP_VERSION() {
    return version.current
  },
}))
vi.mock("./request-lm-studio-response", () => ({ requestLlmResponse: request }))
vi.mock("./analysis-receipt", () => ({ sealAnalysisCompletionReceipt: seal }))
vi.mock("./analysis-server-config", () => ({
  LLM_CONFIG: { model: "synthetic-model" },
}))
vi.mock("@/lib/reception", () => ({ isReceptionClosed: () => false }))
vi.mock("@/lib/session-authority", () => ({
  sessionOperation: { exit: (operation: () => unknown) => operation() },
  watchAuthority: () => {
    const controller = new AbortController()
    watches.push(controller)
    return { signal: controller.signal, dispose: vi.fn() }
  },
}))
const {
  cancelMemoryAnalysisJob,
  reserveAnalysisJob,
  readMemoryAnalysisJob,
  readMemoryAnalysisResult,
  readMemoryAnalysisRetry,
  retryMemoryAnalysisRecording,
  acknowledgeMemoryAnalysisResult,
} = await import("./analysis-job-registry")
const owner = {
  sessionId: "session",
  clientId: "client",
  pseudonym: "participant",
  consentId: "consent",
}
const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
const finish = vi.fn()
const retryFinish = vi.fn()
const input = {
  prompt: "private prompt",
  documentCount: 1,
  documentGraphemeCount: 10,
  documentGraphemeCounts: [8],
  logger: logger as never,
  attempt: { finish, retryFinish, questionnaireKind: "initial" as const },
}
let index = 0
function start() {
  const id = `test-${++index}`
  const reservation = reserveAnalysisJob({
    analysisId: id,
    owner,
    startedAtMs: Date.now(),
  })
  if (!reservation) throw new Error("Reservation failed")
  reservation.start(input)
  return id
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  version.current = "1.0.0"
  request.mockResolvedValue({ ok: true, text: "private output" })
  seal.mockResolvedValue("sealed-receipt")
  finish.mockResolvedValue(true)
  retryFinish.mockResolvedValue(true)
})
afterEach(async () => {
  for (const watch of watches.splice(0)) watch.abort()
  await vi.advanceTimersByTimeAsync(
    limits.maxDurationMs + limits.resultRetentionMs,
  )
  vi.useRealTimers()
})

it("retains one complete result for repeated delivery until acknowledged", async () => {
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("ready"),
  )
  const result = {
    ok: true,
    analysisId: id,
    text: "private output",
    receipt: "sealed-receipt",
  }
  expect(readMemoryAnalysisResult(id, owner)).toEqual(result)
  expect(readMemoryAnalysisResult(id, owner)).toEqual(result)
  expect(
    readMemoryAnalysisResult(id, { ...owner, consentId: "replacement" }),
  ).toBeNull()
  expect(readMemoryAnalysisJob(id, { ...owner, sessionId: "other" })).toBeNull()
  expect(request).toHaveBeenCalledOnce()
  expect(
    acknowledgeMemoryAnalysisResult(id, { ...owner, clientId: "other" }),
  ).toBe(false)
  expect(acknowledgeMemoryAnalysisResult(id, owner)).toBe(true)
  expect(readMemoryAnalysisResult(id, owner)).toBeNull()
  expect(acknowledgeMemoryAnalysisResult(id, owner)).toBe(true)
})

it("reports elapsed server time for repeated observation without restarting inference", async () => {
  request.mockReturnValue(new Promise(() => {}))
  const id = start()
  expect(readMemoryAnalysisJob(id, owner)).toMatchObject({
    analysisId: id,
    status: "running",
    elapsedMs: 0,
  })
  await vi.advanceTimersByTimeAsync(90_000)
  expect(readMemoryAnalysisJob(id, owner)).toMatchObject({
    analysisId: id,
    status: "running",
    elapsedMs: 90_000,
  })
  await vi.advanceTimersByTimeAsync(2000)
  expect(readMemoryAnalysisJob(id, owner)?.elapsedMs).toBe(92_000)
  expect(request).toHaveBeenCalledOnce()
})

it("retries terminal recording with retained output and no new inference", async () => {
  finish.mockResolvedValue(false)
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("completion_pending"),
  )
  expect(readMemoryAnalysisResult(id, owner)).toBeNull()
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(true)
  expect(readMemoryAnalysisResult(id, owner)?.text).toBe("private output")
  expect(request).toHaveBeenCalledOnce()
  expect(retryFinish).toHaveBeenCalledOnce()
})

it("captures the starting workspace version in the receipt and retains it on completion retries", async () => {
  let complete!: (value: { ok: true; text: string }) => void
  request.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  finish.mockResolvedValue(false)
  const id = start()
  version.current = "1.0.1"
  complete({ ok: true, text: "private output" })
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("completion_pending"),
  )
  expect(seal).toHaveBeenCalledWith(
    expect.objectContaining({
      analysisId: id,
      analysisWorkspaceVersion: "1.0.0",
    }),
  )
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(true)
  expect(readMemoryAnalysisResult(id, owner)?.receipt).toBe("sealed-receipt")
  expect(seal).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledOnce()
})

it("offers the exact retained prompt only after a confirmed failed attempt", async () => {
  request.mockResolvedValue({ ok: false, reason: "llm_unavailable" })
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("failed"),
  )
  expect(readMemoryAnalysisJob(id, owner)?.canRetry).toBe(true)
  expect(readMemoryAnalysisRetry(id, owner)).toEqual({
    prompt: "private prompt",
    documentCount: 1,
    documentGraphemeCount: 10,
    documentGraphemeCounts: [8],
  })
  expect(
    readMemoryAnalysisRetry(id, { ...owner, pseudonym: "other" }),
  ).toBeNull()
  expect(JSON.stringify(readMemoryAnalysisJob(id, owner))).not.toMatch(
    /private prompt|private output/,
  )
  expect(readMemoryAnalysisResult(id, owner)).toBeNull()
})

it("does not permit inference retry from unacknowledged or completed evidence", async () => {
  finish.mockResolvedValue(false)
  request.mockResolvedValue({ ok: false, reason: "llm_unavailable" })
  const unknown = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(unknown, owner)?.status).toBe(
      "termination_pending",
    ),
  )
  expect(readMemoryAnalysisRetry(unknown, owner)).toBeNull()
  expect(readMemoryAnalysisJob(unknown, owner)?.canRetry).toBe(false)
  finish.mockResolvedValue(true)
  request.mockResolvedValue({ ok: true, text: "private output" })
  const completed = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(completed, owner)?.status).toBe("ready"),
  )
  expect(readMemoryAnalysisRetry(completed, owner)).toBeNull()
})

it("retries failed terminal delivery explicitly, without another model call or extending retention", async () => {
  finish.mockResolvedValue(false)
  request.mockResolvedValue({ ok: false, reason: "llm_unavailable" })
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe(
      "termination_pending",
    ),
  )
  const expiry = readMemoryAnalysisJob(id, owner)?.expiresAtMs
  expect(
    await retryMemoryAnalysisRecording(id, { ...owner, consentId: "other" }),
  ).toBe(false)
  expect(retryFinish).not.toHaveBeenCalled()
  retryFinish.mockResolvedValueOnce(false)
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(false)
  expect(readMemoryAnalysisRetry(id, owner)).toBeNull()
  await vi.advanceTimersByTimeAsync(1000)
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(true)
  expect(readMemoryAnalysisJob(id, owner)).toMatchObject({
    status: "failed",
    reason: "llm_unavailable",
    canRetry: true,
    expiresAtMs: expiry,
  })
  expect(request).toHaveBeenCalledOnce()
  expect(readMemoryAnalysisResult(id, owner)).toBeNull()
  await vi.advanceTimersByTimeAsync(limits.resultRetentionMs)
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(false)
})

it.each([false, undefined, null, "false", "true", 1, {}, []])(
  "never confirms terminal recording from non-true retry evidence (%j)",
  async (recorded) => {
    finish.mockResolvedValue(false)
    request.mockResolvedValue({ ok: false, reason: "llm_unavailable" })
    const id = start()
    await vi.waitFor(() =>
      expect(readMemoryAnalysisJob(id, owner)?.status).toBe(
        "termination_pending",
      ),
    )
    retryFinish.mockResolvedValueOnce(recorded)
    expect(await retryMemoryAnalysisRecording(id, owner)).toBe(false)
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("termination_pending")
    expect(readMemoryAnalysisRetry(id, owner)).toBeNull()
  },
)

it("can record a timed-out attempt after its inference signal has been aborted", async () => {
  finish.mockResolvedValue(false)
  request.mockImplementation(
    ({ signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("timeout"))),
      ),
  )
  const id = start()
  await vi.advanceTimersByTimeAsync(limits.maxDurationMs)
  expect(readMemoryAnalysisJob(id, owner)?.status).toBe("termination_pending")
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(true)
  expect(readMemoryAnalysisJob(id, owner)).toMatchObject({
    status: "failed",
    reason: "timeout",
    canRetry: true,
  })
  expect(request).toHaveBeenCalledOnce()
})

it("coalesces terminal retries and rejects a late acknowledgement after revocation", async () => {
  finish.mockResolvedValue(false)
  request.mockResolvedValue({ ok: false, reason: "llm_unavailable" })
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe(
      "termination_pending",
    ),
  )
  const deferred = Promise.withResolvers<boolean>()
  retryFinish.mockReturnValueOnce(deferred.promise)
  const first = retryMemoryAnalysisRecording(id, owner)
  const second = retryMemoryAnalysisRecording(id, owner)
  expect(retryFinish).toHaveBeenCalledOnce()
  watches.at(-1)?.abort()
  deferred.resolve(true)
  expect(await first).toBe(false)
  expect(await second).toBe(false)
  expect(readMemoryAnalysisJob(id, owner)).toBeNull()
})

it("keeps successful output retryable when terminal recording unexpectedly throws", async () => {
  finish.mockRejectedValueOnce(new Error("storage failure"))
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("completion_pending"),
  )
  expect(finish).toHaveBeenCalledExactlyOnceWith("completed")
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(true)
  expect(readMemoryAnalysisResult(id, owner)?.text).toBe("private output")
  expect(request).toHaveBeenCalledOnce()
})

it("discards results and prompts when authority is revoked", async () => {
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("ready"),
  )
  watches.at(-1)?.abort()
  expect(readMemoryAnalysisResult(id, owner)).toBeNull()
  expect(readMemoryAnalysisRetry(id, owner)).toBeNull()
  expect(readMemoryAnalysisJob(id, owner)).toBeNull()
})

it("expires retained output even without another request", async () => {
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("ready"),
  )
  await vi.advanceTimersByTimeAsync(limits.resultRetentionMs)
  expect(readMemoryAnalysisJob(id, owner)).toBeNull()
  expect(readMemoryAnalysisResult(id, owner)).toBeNull()
})

it("bounds active inference and retains its failed prompt for explicit retry", async () => {
  request.mockImplementation(
    ({ signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("Cancelled", "AbortError")),
        ),
      ),
  )
  const id = start()
  await vi.advanceTimersByTimeAsync(limits.maxDurationMs)
  expect(readMemoryAnalysisJob(id, owner)).toMatchObject({
    status: "failed",
    reason: "timeout",
    canRetry: true,
  })
  expect(finish).toHaveBeenCalledWith("failed")
  await vi.advanceTimersByTimeAsync(limits.resultRetentionMs)
  expect(readMemoryAnalysisRetry(id, owner)).toBeNull()
})

it("caps reservations and releases their memory budget", () => {
  const reservations = Array.from({ length: limits.maxJobs }, (_, number) =>
    reserveAnalysisJob({
      analysisId: `capacity-${number}`,
      owner,
      startedAtMs: Date.now(),
    }),
  )
  expect(reservations.every((reservation) => reservation !== null)).toBe(true)
  expect(
    reserveAnalysisJob({
      analysisId: "excess",
      owner,
      startedAtMs: Date.now(),
    }),
  ).toBeNull()
  reservations[0]?.release()
  const replacement = reserveAnalysisJob({
    analysisId: "replacement",
    owner,
    startedAtMs: Date.now(),
  })
  expect(replacement).not.toBeNull()
  replacement?.release()
  for (const reservation of reservations) reservation?.release()
})

it("keeps acknowledged completion at debug level and unconfirmed completion visible", async () => {
  const ready = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(ready, owner)?.status).toBe("ready"),
  )
  expect(logger.debug).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "llm.analysis.completed",
      outcome: "completed",
    }),
  )
  expect(logger.info).not.toHaveBeenCalledWith(
    expect.objectContaining({ event: "llm.analysis.completed" }),
  )
  finish.mockResolvedValueOnce(false)
  const pending = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(pending, owner)?.status).toBe(
      "completion_pending",
    ),
  )
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "llm.analysis.completed",
      outcome: "partial",
    }),
  )
})

it("retains a cancelled attempt until terminal retry succeeds, without rerunning inference", async () => {
  request.mockImplementation(
    ({ signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      ),
  )
  finish.mockResolvedValueOnce(false)
  const id = start()
  await cancelMemoryAnalysisJob(id, { ...owner, consentId: "other" })
  expect(readMemoryAnalysisJob(id, owner)?.status).toBe("running")
  await cancelMemoryAnalysisJob(id, owner)
  expect(readMemoryAnalysisJob(id, owner)?.status).toBe("termination_pending")
  expect(finish).toHaveBeenCalledExactlyOnceWith("cancelled")
  expect(readMemoryAnalysisRetry(id, owner)).toBeNull()
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(true)
  expect(readMemoryAnalysisJob(id, owner)?.status).toBe("cancelled")
  await cancelMemoryAnalysisJob(id, owner)
  expect(finish).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledOnce()
})
it("preserves completion that wins a cancellation race while recording is pending", async () => {
  const delivery = Promise.withResolvers<boolean>()
  finish.mockReturnValueOnce(delivery.promise)
  const id = start()
  await vi.waitFor(() =>
    expect(readMemoryAnalysisJob(id, owner)?.status).toBe("recording"),
  )
  const cancel = cancelMemoryAnalysisJob(id, owner)
  delivery.resolve(true)
  await cancel
  expect(readMemoryAnalysisResult(id, owner)?.text).toBe("private output")
  expect(finish).toHaveBeenCalledExactlyOnceWith("completed")
})

it("retains terminal retry after admission fails following an accepted start", async () => {
  const id = `test-${++index}`
  const reservation = reserveAnalysisJob({
    analysisId: id,
    owner,
    startedAtMs: Date.now(),
  })
  finish.mockResolvedValueOnce(false)
  await reservation?.terminate(input.attempt, logger as never)
  expect(readMemoryAnalysisJob(id, owner)?.status).toBe("termination_pending")
  expect(request).not.toHaveBeenCalled()
  expect(await retryMemoryAnalysisRecording(id, owner)).toBe(true)
  expect(readMemoryAnalysisJob(id, owner)?.status).toBe("cancelled")
  expect(readMemoryAnalysisRetry(id, owner)).toBeNull()
})
