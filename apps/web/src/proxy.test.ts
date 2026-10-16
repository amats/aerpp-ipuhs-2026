import { beforeEach, describe, expect, it, vi } from "vitest"

const nextMock = vi.fn()
const runtime = vi.hoisted(() => ({ debugPagesEnabled: true }))
vi.mock("@aerpp/config/server/web", () => ({ env: runtime }))

vi.mock("next/server", () => ({
  NextResponse: {
    next: nextMock,
  },
}))

describe("proxy", () => {
  beforeEach(() => {
    runtime.debugPagesEnabled = true
    vi.clearAllMocks()
    nextMock.mockImplementation(({ request }) => ({
      headers: new Headers(),
      request,
    }))
  })

  it.each(["/debug", "/debug/home-flow", "/debug/alert-message", "/reset"])(
    "rejects disabled %s before rendering and preserves the request id",
    async (path) => {
      runtime.debugPagesEnabled = false
      const { proxy } = await import("./proxy")
      const response = proxy(
        new Request(`http://localhost${path}`, {
          headers: { "x-request-id": "request-id-1234" },
        }) as never,
      )
      expect(response.status).toBe(404)
      expect(response.headers.get("x-request-id")).toBe("request-id-1234")
      expect(response.headers.get("Cache-Control")).toBe("no-store")
      expect(nextMock).not.toHaveBeenCalled()
    },
  )

  it.each(["/debug", "/debug/home-flow", "/debug/alert-message", "/reset"])(
    "allows enabled %s to reach the application",
    async (path) => {
      const { proxy } = await import("./proxy")
      proxy(new Request(`http://localhost${path}`) as never)
      expect(nextMock).toHaveBeenCalledOnce()
    },
  )

  it.each(["/", "/debugger", "/reset-password"])(
    "preserves ordinary route %s when debug is disabled",
    async (path) => {
      runtime.debugPagesEnabled = false
      const { proxy } = await import("./proxy")
      proxy(new Request(`http://localhost${path}`) as never)
      expect(nextMock).toHaveBeenCalledOnce()
    },
  )

  it("preserves a valid incoming request id across request and response headers", async () => {
    const { proxy } = await import("./proxy")
    const request = new Request("http://localhost/survey", {
      headers: { "x-request-id": "request-id-1234" },
    })

    const response = await proxy(request as never)

    expect(nextMock).toHaveBeenCalledWith({
      request: {
        headers: expect.any(Headers),
      },
    })
    const forwardedHeaders = nextMock.mock.calls[0]?.[0]?.request
      ?.headers as Headers
    expect(forwardedHeaders.get("x-request-id")).toBe("request-id-1234")
    expect(response.headers.get("x-request-id")).toBe("request-id-1234")
  })

  it("generates a request id when the incoming one is blank or invalid", async () => {
    const { proxy } = await import("./proxy")
    const request = new Request("http://localhost/survey", {
      headers: { "x-request-id": " " },
    })

    const response = await proxy(request as never)
    const forwardedHeaders = nextMock.mock.calls[0]?.[0]?.request
      ?.headers as Headers
    const requestId = forwardedHeaders.get("x-request-id")

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(response.headers.get("x-request-id")).toBe(requestId)
  })

  it("excludes known static asset routes from the matcher", async () => {
    const { config } = await import("./proxy")

    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.json|apple-icon.png|icon.svg).*)",
    ])
  })
})
