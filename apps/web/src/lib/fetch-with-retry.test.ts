import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchWithRetry } from "./fetch-with-retry"
import { LOG_EVENT } from "./logger-events"

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns response when fetch succeeds", async () => {
    const response = new Response("ok", { status: 200 })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchWithRetry(
      "https://example.com",
      {},
      { timeoutMs: 100 },
    )

    expect(result).toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries and eventually succeeds", async () => {
    const response = new Response("ok", { status: 200 })
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockResolvedValueOnce(response)
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchWithRetry(
      "https://example.com",
      {},
      { timeoutMs: 100, retries: 1, retryDelayMs: 1 },
    )

    expect(result).toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws after all retries are exhausted", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      fetchWithRetry(
        "https://example.com",
        {},
        { timeoutMs: 100, retries: 2, retryDelayMs: 1 },
      ),
    ).rejects.toThrow("network")
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("retries on retryable HTTP status and eventually succeeds", async () => {
    const response = new Response("ok", { status: 200 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(response)
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchWithRetry(
      "https://example.com",
      {},
      { timeoutMs: 100, retries: 1, retryDelayMs: 1 },
    )

    expect(result).toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("logs retrying rather than failed for retryable HTTP responses", async () => {
    const response = new Response("ok", { status: 200 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(response)
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }
    vi.stubGlobal("fetch", fetchMock)

    await fetchWithRetry(
      "https://example.com",
      {},
      {
        logging: {
          dependency: "upstream_service",
          logger: logger as never,
          target: "participant_api",
        },
        retries: 1,
        retryDelayMs: 1,
        timeoutMs: 100,
      },
    )

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LOG_EVENT.dependencyRequestRetried,
        statusCode: 503,
      }),
    )
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: LOG_EVENT.dependencyRequestFailed,
        statusCode: 503,
      }),
    )
  })

  it("does not retry on non-retryable HTTP status", async () => {
    const response = new Response("bad request", { status: 400 })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchWithRetry(
      "https://example.com",
      {},
      { timeoutMs: 100, retries: 3, retryDelayMs: 1 },
    )

    expect(result.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("emits dependency logging events for retry and suppresses success logs", async () => {
    const response = new Response("ok", { status: 200 })
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockResolvedValueOnce(response)
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }
    vi.stubGlobal("fetch", fetchMock)

    await fetchWithRetry(
      "https://example.com",
      {},
      {
        logging: {
          dependency: "upstream_service",
          logger: logger as never,
          target: "participant_api",
        },
        retries: 1,
        retryDelayMs: 1,
        timeoutMs: 100,
      },
    )

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: LOG_EVENT.dependencyRequestRetried }),
    )
    expect(logger.info).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "keeps the deadline active during body reads (caller signal=%s)",
    async (hasCallerSignal) => {
      const caller = new AbortController()
      let cancelBody!: () => void
      const fetchMock = vi.fn(
        async (_input, init: RequestInit) =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"count":'))
                cancelBody = () => controller.error(new Error("test cleanup"))
                init.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true },
                )
              },
            }),
          ),
      )
      vi.stubGlobal("fetch", fetchMock)
      const response = await fetchWithRetry(
        "https://example.com",
        hasCallerSignal ? { signal: caller.signal } : {},
        { timeoutMs: 20, retries: 2 },
      )
      let watchdog!: ReturnType<typeof setTimeout>
      try {
        const result = await Promise.race([
          response.json().then(
            () => "completed",
            (error: Error) => error.name,
          ),
          new Promise<string>((resolve) => {
            watchdog = setTimeout(() => resolve("still waiting"), 200)
          }),
        ])
        expect(result).toBe("TimeoutError")
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(caller.signal.aborted).toBe(false)
      } finally {
        clearTimeout(watchdog)
        cancelBody()
      }
    },
  )

  it("preserves caller cancellation during response body reads", async () => {
    const caller = new AbortController()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input, init: RequestInit) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true },
                )
              },
            }),
          ),
      ),
    )
    const response = await fetchWithRetry(
      "https://example.com",
      { signal: caller.signal },
      { timeoutMs: 1000 },
    )
    const body = response.text()
    caller.abort()
    await expect(body).rejects.toMatchObject({ name: "AbortError" })
  })

  it("keeps a 429 response when Retry-After cannot fit in the total budget", async () => {
    const response = new Response("busy", {
      status: 429,
      headers: { "Retry-After": "60" },
    })
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetch)
    expect(
      await fetchWithRetry(
        "https://example.invalid",
        {},
        {
          timeoutMs: 100,
          totalTimeoutMs: 500,
          retries: 1,
          retryDelayMs: 1,
        },
      ),
    ).toBe(response)
    expect(await response.text()).toBe("busy")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("stops the backoff promptly on cancellation without replaying a submitted request", async () => {
    const controller = new AbortController()
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("busy", { status: 503 }))
    vi.stubGlobal("fetch", fetch)
    const pending = fetchWithRetry(
      "https://example.invalid",
      { method: "POST", signal: controller.signal },
      {
        timeoutMs: 100,
        totalTimeoutMs: 5000,
        retries: 1,
        retryDelayMs: 2000,
      },
    )
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await rejected
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("does not renew the total budget when another attempt needs a full timeout", async () => {
    const fetch = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      throw new Error("acknowledgement lost")
    })
    vi.stubGlobal("fetch", fetch)
    await expect(
      fetchWithRetry(
        "https://example.invalid",
        { method: "POST" },
        {
          timeoutMs: 100,
          totalTimeoutMs: 120,
          retries: 2,
          retryDelayMs: 1,
        },
      ),
    ).rejects.toThrow("acknowledgement lost")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("keeps the response readable when backoff leaves too little time for a full retry", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(450)
    const response = new Response("busy", { status: 503 })
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetch)
    const result = await fetchWithRetry(
      "https://example.invalid",
      { method: "POST" },
      { timeoutMs: 100, totalTimeoutMs: 500, retries: 1, retryDelayMs: 1 },
    )
    expect(result).toBe(response)
    expect(await result.text()).toBe("busy")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("does not retry a transport failure after backoff consumes the remaining attempt budget", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(450)
    const fetch = vi.fn().mockRejectedValue(new Error("acknowledgement lost"))
    vi.stubGlobal("fetch", fetch)
    await expect(
      fetchWithRetry(
        "https://example.invalid",
        { method: "POST" },
        { timeoutMs: 100, totalTimeoutMs: 500, retries: 1, retryDelayMs: 1 },
      ),
    ).rejects.toThrow("acknowledgement lost")
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("honors Retry-After even when discarding the failed response rejects", async () => {
    const response = new Response("busy", {
      status: 503,
      headers: { "Retry-After": "1" },
    })
    if (response.body === null) throw new Error("Expected response body")
    vi.spyOn(response.body, "cancel").mockRejectedValue(
      new Error("body expired"),
    )
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(new Response("ok"))
    vi.stubGlobal("fetch", fetch)
    const started = performance.now()
    const result = await fetchWithRetry(
      "https://example.invalid",
      { method: "POST" },
      { timeoutMs: 100, totalTimeoutMs: 5000, retries: 1, retryDelayMs: 1 },
    )
    expect(await result.text()).toBe("ok")
    expect(performance.now() - started).toBeGreaterThanOrEqual(990)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
