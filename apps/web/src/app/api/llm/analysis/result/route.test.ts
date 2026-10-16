import { beforeEach, expect, it, vi } from "vitest"

const { access, acknowledge, admission } = vi.hoisted(() => ({
  access: vi.fn(),
  acknowledge: vi.fn(),
  admission: vi.fn(),
}))
vi.mock("@/features/llm/analysis-job-access", () => ({
  readAnalysisJobAccess: access,
  readAnalysisJobResultForTab: vi.fn(),
  readAnalysisJobStatusForTab: vi.fn(),
}))
vi.mock("@/features/llm/analysis-job-registry", () => ({
  acknowledgeMemoryAnalysisResult: acknowledge,
}))
vi.mock("@/features/session/session-operation", () => ({
  withSessionOperation: admission,
}))
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({
    logger: { warn: vi.fn() },
    requestId: "request-id",
  }),
}))
const { DELETE } = await import("./route")
const id = `aerpp:aid-${"a".repeat(32)}`
const owner = {
  sessionId: "session",
  clientId: "client",
  pseudonym: "participant",
  consentId: "consent",
}
beforeEach(() => {
  vi.clearAllMocks()
  admission.mockImplementation((_token, _kind, operation) => operation())
  access.mockResolvedValue({
    session: { lastCompletedAnalysisId: id, presentedAnalysisId: id },
    owner,
  })
  acknowledge.mockReturnValue(true)
})
function request(value = id) {
  return new Request(
    `http://localhost/api/llm/analysis/result?analysisId=${value}`,
    { method: "DELETE", headers: { "x-aerpp-tab": "current-token" } },
  )
}
it("releases acknowledged RAM only after finalized presentation", async () => {
  const response = await DELETE(request())
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("x-request-id")).toBe("request-id")
  expect(admission).toHaveBeenCalledWith(
    "current-token",
    "survey",
    expect.any(Function),
  )
  expect(acknowledge).toHaveBeenCalledWith(id, owner)
})
it.each(["unpresented", "different", "stale", "invalid"])(
  "retains RAM for rejected acknowledgement (%s)",
  async (condition) => {
    if (condition === "unpresented")
      access.mockResolvedValue({
        session: { lastCompletedAnalysisId: id },
        owner,
      })
    if (condition === "different")
      access.mockResolvedValue({
        session: {
          lastCompletedAnalysisId: "different",
          presentedAnalysisId: "different",
        },
        owner,
      })
    if (condition === "stale")
      admission.mockResolvedValue({ ok: false, reason: "stale_session_state" })
    const response = await DELETE(
      request(condition === "invalid" ? "invalid" : id),
    )
    expect([400, 409]).toContain(response.status)
    expect(acknowledge).not.toHaveBeenCalled()
  },
)
