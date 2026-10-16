import { beforeEach, expect, it, vi } from "vitest"
import { POST } from "./route"

const { readStatus } = vi.hoisted(() => ({ readStatus: vi.fn() }))
vi.mock("@/features/session/session-status-service", () => ({
  readSessionStatus: readStatus,
}))
const token = `22222222-2222-2222-2222-222222222222:${"a".repeat(64)}`
beforeEach(() => {
  readStatus.mockReset()
})

it("returns uncached status and preserves the request ID without setting cookies", async () => {
  const status = {
    admitted: true,
    analysisId: null,
    submitted: null,
    withdrawing: false,
    stepState: { stage: "unauthenticated", step: "start" },
  }
  readStatus.mockResolvedValue(status)
  const response = await POST(
    new Request("http://localhost/api/session-status", {
      method: "POST",
      headers: { "x-aerpp-tab": token, "x-request-id": "test-request" },
    }),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("set-cookie")).toBeNull()
  expect(response.headers.get("x-request-id")).toBe("test-request")
  expect(await response.json()).toEqual(status)
})

it.each([
  {},
  { "x-aerpp-tab": "invalid" },
  {
    "x-aerpp-tab":
      "22222222-2222-2222-2222-222222222222:11111111-1111-1111-1111-111111111111",
  },
  { "x-aerpp-tab": token, "sec-fetch-site": "cross-site" },
])(
  "rejects malformed and cross-site requests before reading the session: %j",
  async (headers) => {
    const response = await POST(
      new Request("http://localhost/api/session-status", {
        method: "POST",
        headers: headers as HeadersInit,
      }),
    )
    expect(response.status).toBe(400)
    expect(readStatus).not.toHaveBeenCalled()
  },
)

it.each(["missing", "failed"])(
  "does not admit a tab with %s authority",
  async (state) => {
    if (state === "missing") readStatus.mockResolvedValue(null)
    else readStatus.mockRejectedValue(new Error("Synthetic read failure"))
    const response = await POST(
      new Request("http://localhost/api/session-status", {
        method: "POST",
        headers: { "x-aerpp-tab": token },
      }),
    )
    expect(response.status).toBe(state === "missing" ? 409 : 503)
    expect(await response.json()).toBeNull()
  },
)
