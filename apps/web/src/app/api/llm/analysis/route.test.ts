import { beforeEach, expect, it, vi } from "vitest"
import { DOCUMENT_CONSTRAINTS } from "@/features/document/document-constraints"

const { session, authentication, accepted, logger, step, admission } =
  vi.hoisted(() => ({
    session: vi.fn(),
    authentication: vi.fn(),
    accepted: vi.fn(),
    step: vi.fn(),
    admission: vi.fn(),
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  }))
vi.mock("@/lib/session", () => ({
  getSession: session,
  getSessionToken: () => "current-token",
}))
vi.mock("@/features/session/session-operation", () => ({
  withSessionOperation: admission,
}))
vi.mock("@/lib/session-authority", () => ({
  sessionOperation: { getStore: () => undefined },
}))
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({ logger, requestId: "request-id" }),
  logRouteRejected: vi.fn(),
}))
vi.mock("@/features/auth/auth-session", () => ({
  readLocalAuthenticationFromSession: authentication,
  isLocallyAuthenticated: (value: unknown) => value !== null,
}))
vi.mock("@/features/app-context/step-state-session", () => ({
  readStepStateFromSession: step,
}))
vi.mock("@/features/llm/analysis-job-service", () => ({
  acceptAnalysisJob: accepted,
}))
vi.mock("@/features/llm/request-lm-studio-response", () => ({
  buildAnalysisUserPrompt: () => "private-prompt",
}))
vi.mock("@/features/llm/analysis-job-route", () => ({
  handleAnalysisJobRead: vi.fn(),
}))
const { POST } = await import("./route")

beforeEach(() => {
  vi.clearAllMocks()
  admission.mockImplementation((_token, _kind, operation) => operation())
  session.mockResolvedValue({
    coordinationId: "session",
    consentId: "consent",
    clientId: "client",
    pseudonym: "participant",
  })
  authentication.mockResolvedValue({
    clientId: "client",
    pseudonym: "participant",
  })
  step.mockResolvedValue({ stage: "authenticated", step: "result" })
  accepted.mockResolvedValue({
    ok: true,
    analysisId: "analysis",
    status: "running",
    startedAtMs: 1,
    elapsedMs: 0,
  })
})

function request(body: unknown, headers = {}) {
  return new Request("http://localhost/api/llm/analysis", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

it("acknowledges admission without awaiting or returning model output", async () => {
  const response = await POST(
    request({ documents: [{ name: "計画", text: "é👨‍👩‍👧‍👦" }] }) as never,
  )
  expect(response.status).toBe(202)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(response.headers.get("x-request-id")).toBe("request-id")
  expect(response.headers.get("x-aerpp-session-token")).toBe("current-token")
  expect(await response.json()).toMatchObject({ ok: true, status: "running" })
  expect(accepted.mock.calls[0][0].input).toEqual({
    prompt: "private-prompt",
    documentCount: 1,
    documentGraphemeCount: 4,
    documentGraphemeCounts: [2],
  })
  expect(JSON.stringify(logger)).not.toContain("private-prompt")
})

it.each([
  { documents: ["invalid document shape"] },
  { documents: [{ name: "", text: "body" }] },
  { documents: [{ name: "x".repeat(201), text: "body" }] },
  { documents: [{ name: "document", text: 123 }] },
  { documents: [{ name: "document", text: " " }] },
  {
    documents: Array.from({ length: 21 }, () => ({
      name: "document",
      text: "body",
    })),
  },
  { documents: [{ name: "document", text: "x".repeat(30_001) }] },
  { documents: [], unrelated: true },
])("rejects invalid document payloads before admission (%#)", async (body) => {
  const response = await POST(request(body) as never)
  expect(response.status).toBe(400)
  expect(response.headers.get("x-request-id")).toBe("request-id")
  expect(accepted).not.toHaveBeenCalled()
})

it("bounds both declared and streamed request bytes", async () => {
  const body = { documents: [{ name: "document", text: "body" }] }
  expect(
    (
      await POST(
        request(body, {
          "Content-Length": String(DOCUMENT_CONSTRAINTS.maxRequestBytes + 1),
        }) as never,
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await POST(
        new Request("http://localhost/api/llm/analysis", {
          method: "POST",
          body: "x".repeat(DOCUMENT_CONSTRAINTS.maxRequestBytes + 1),
        }) as never,
      )
    ).status,
  ).toBe(400)
  expect(accepted).not.toHaveBeenCalled()
})

it("rejects excessive combining code units even with a small grapheme count", async () => {
  const response = await POST(
    request({
      documents: Array.from({ length: 3 }, () => ({
        name: "document",
        text: `a${"\u0301".repeat(99_999)}`,
      })),
    }) as never,
  )
  expect(response.status).toBe(400)
  expect(accepted).not.toHaveBeenCalled()
})

it.each(["authentication", "step", "consent", "credential"])(
  "requires the current authorized boundary (%s)",
  async (missing) => {
    if (missing === "authentication") authentication.mockResolvedValue(null)
    if (missing === "step")
      step.mockResolvedValue({ stage: "authenticated", step: "document" })
    if (missing === "consent")
      session.mockResolvedValue({ coordinationId: "session" })
    if (missing === "credential")
      admission.mockResolvedValue({ ok: false, reason: "stale_session_state" })
    const response = await POST(
      request({ documents: [{ name: "document", text: "body" }] }) as never,
    )
    expect([401, 409]).toContain(response.status)
    expect(accepted).not.toHaveBeenCalled()
  },
)

it("returns typed stale-state rejection for browser reload recovery", async () => {
  admission.mockResolvedValue({ ok: false, reason: "stale_session_state" })
  const response = await POST(
    request({ documents: [{ name: "synthetic", text: "body" }] }) as never,
  )
  expect(response.status).toBe(409)
  expect(response.headers.get("x-request-id")).toBe("request-id")
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(await response.json()).toEqual({
    ok: false,
    reason: "stale_session_state",
  })
  expect(accepted).not.toHaveBeenCalled()
})
