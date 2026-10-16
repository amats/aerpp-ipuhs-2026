import { beforeEach, expect, it, vi } from "vitest"

const { request, writable } = vi.hoisted(() => ({
  request: vi.fn(),
  writable: vi.fn(),
}))
vi.mock("@/lib/fetch-with-retry", () => ({ fetchWithRetry: request }))
vi.mock("@/lib/analysis-audit-store", () => ({
  analysisAuditStore: () => ({ assertWritable: writable }),
}))
vi.mock("./analysis-server-config", () => ({
  LLM_CONFIG: { baseUrl: "http://127.0.0.1:1234/v1", model: "synthetic-model" },
}))
const { checkAnalysisReadiness } = await import("./analysis-readiness")
const session = {
  clientId: "client",
  pseudonym: "person",
  consentId: "consent",
}
const logger = { error: vi.fn(), warn: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  request.mockImplementation(async (url: string) =>
    Response.json(
      url.endsWith("/models")
        ? { data: [{ id: "synthetic-model" }] }
        : { ok: true, questionnaireKind: "initial" },
    ),
  )
})
it("checks storage and both dependencies without inference, documents or a study claim", async () => {
  expect(
    await checkAnalysisReadiness(session as never, logger as never),
  ).toEqual({ ok: true })
  expect(writable).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledTimes(2)
  const model = request.mock.calls.find(([url]) => url.endsWith("/models"))
  expect(model?.[1]).toMatchObject({ method: "GET", redirect: "error" })
  expect(model?.[1]).not.toHaveProperty("body")
  expect(model?.[1]).not.toHaveProperty("headers.Authorization")
  expect(JSON.stringify(request.mock.calls)).not.toMatch(
    /responses|recordAnalysisAttempt|prompt|documents/,
  )
})
it("does not contact dependencies when local persistence is unavailable", async () => {
  writable.mockImplementationOnce(() => {
    throw new Error("SQLite unavailable")
  })
  expect(
    await checkAnalysisReadiness(session as never, logger as never),
  ).toEqual({ ok: false, reason: "analysis_storage_unavailable" })
  expect(request).not.toHaveBeenCalled()
})
it.each(["network", "missing_model", "invalid_json", "oversize"])(
  "rejects unavailable model readiness (%s)",
  async (fault) => {
    request.mockImplementationOnce(async () => {
      if (fault === "network") throw new Error("offline")
      if (fault === "invalid_json") return new Response("{")
      if (fault === "oversize")
        return Response.json({
          data: [{ id: "synthetic-model" }],
          padding: "x".repeat(64 * 1024),
        })
      return Response.json({ data: [{ id: "other-model" }] })
    })
    expect(
      await checkAnalysisReadiness(session as never, logger as never),
    ).toEqual({ ok: false, reason: "analysis_model_unavailable" })
  },
)
it.each([false, undefined, null, "false", "true", 1, {}, []])(
  "requires strict Support authorization (%j)",
  async (ok) => {
    request.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith("/models")
          ? { data: [{ id: "synthetic-model" }] }
          : { ok, questionnaireKind: "initial" },
      ),
    )
    expect(
      await checkAnalysisReadiness(session as never, logger as never),
    ).toEqual({ ok: false, reason: "analysis_support_unavailable" })
  },
)
