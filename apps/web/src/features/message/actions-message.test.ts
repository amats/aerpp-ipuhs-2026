import { beforeEach, describe, expect, it, vi } from "vitest"

const headersMock = vi.fn()
const fetchWithRetryMock = vi.fn()
const loggerMock = {
  child: vi.fn(() => loggerMock),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}
const createLoggerMock = vi.fn(() => loggerMock)
const getRequestContextFromHeadersMock = vi.fn(() => ({}))

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

vi.mock("@aerpp/config/server/web", () => ({
  env: {
    receptionExpiresAt: new Date("2099-01-01T00:00:00Z"),
    getInformationUrl: "https://example.com/information",
    supportApiCredential: "magic-key",
  },
}))

vi.mock("@/lib/fetch-with-retry", () => ({
  fetchWithRetry: fetchWithRetryMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: createLoggerMock,
  getRequestContextFromHeaders: getRequestContextFromHeadersMock,
}))

describe("actions-message", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
  })

  it("returns upstream information messages when the payload is valid", async () => {
    fetchWithRetryMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              id: "1",
              content: "Message 1",
              tone: "info",
            },
            {
              id: "2",
              content: "Message 2",
              tone: "warning",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    )

    const { getInformationMessagesAction } = await import("./actions-message")

    await expect(getInformationMessagesAction()).resolves.toEqual([
      {
        id: "1",
        content: "Message 1",
        tone: "info",
      },
      {
        id: "2",
        content: "Message 2",
        tone: "warning",
      },
    ])
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      "https://example.com/information",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer magic-key",
        },
      }),
      expect.any(Object),
    )
  })

  it("returns unavailable when the upstream payload shape is invalid", async () => {
    fetchWithRetryMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { getInformationMessagesAction } = await import("./actions-message")

    await expect(getInformationMessagesAction()).resolves.toBeNull()
  })

  it.each(["http", "transport", "body"])(
    "distinguishes %s failures from a successful empty response",
    async (failure) => {
      if (failure === "http") {
        fetchWithRetryMock.mockResolvedValueOnce(
          new Response("unavailable", { status: 503 }),
        )
      } else if (failure === "transport") {
        fetchWithRetryMock.mockRejectedValueOnce(new Error("offline"))
      } else {
        fetchWithRetryMock.mockResolvedValueOnce(new Response("not json"))
      }
      const { getInformationMessagesAction } = await import("./actions-message")
      await expect(getInformationMessagesAction()).resolves.toBeNull()
      fetchWithRetryMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [] })),
      )
      await expect(getInformationMessagesAction()).resolves.toEqual([])
    },
  )

  it("rejects the response when a message has an unsupported tone", async () => {
    fetchWithRetryMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              id: "1",
              content: "Message 1",
              tone: "info",
            },
            {
              id: "2",
              content: "Message 2",
              tone: "unknown",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    )

    const { getInformationMessagesAction } = await import("./actions-message")

    await expect(getInformationMessagesAction()).resolves.toBeNull()
  })
})
