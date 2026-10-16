import { beforeEach, expect, it, vi } from "vitest"

const { claim, settle, health, headers, log } = vi.hoisted(() => ({
  claim: vi.fn(),
  settle: vi.fn(),
  health: vi.fn(),
  headers: vi.fn(),
  log: vi.fn(),
}))
vi.mock("@/lib/analysis-audit-store", () => ({
  analysisAuditStore: () => ({ claim, settle, health }),
}))
vi.mock("@/lib/participant-api-headers", () => ({
  participantAuditHeaders: headers,
}))
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ error: log, warn: log }),
}))

import { drainAnalysisAudit } from "./analysis-audit-delivery"

const body = {
  analysisId: "analysis",
  serverId: "server",
  clientId: "client",
  pseudonym: "person",
  consentId: "consent",
  outcome: "completed",
  endedAtMs: 2000,
}
const lease = { id: "lease", token: "token", body, attempts: 1 }
beforeEach(() => {
  vi.resetAllMocks()
  health.mockReturnValue({ pendingCount: 0, blockedCount: 0, oldestAgeMs: 0 })
  claim.mockReturnValueOnce(lease).mockReturnValue(null)
  headers.mockReturnValue({ Authorization: "Bearer synthetic" })
})
it("posts only the operational schema and acknowledges a validated response", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
  vi.stubGlobal("fetch", fetch)
  await drainAnalysisAudit()
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body)
  expect(settle).toHaveBeenCalledWith(
    lease,
    true,
    200,
    expect.any(Number),
    null,
  )
  expect(headers).toHaveBeenCalledOnce()
  expect(log).not.toHaveBeenCalled()
})
it.each([
  Response.json({ ok: "true" }),
  Response.json({ error: "private" }, { status: 409 }),
])(
  "retains failed or invalid acknowledgments without logging their body",
  async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
    await drainAnalysisAudit()
    expect(settle).toHaveBeenCalledWith(
      lease,
      false,
      response.status,
      expect.any(Number),
      null,
    )
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /private|consent|Bearer|endedAtMs/,
    )
  },
)
it("retains a network failure for a later delivery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("private@example.invalid")),
  )
  await drainAnalysisAudit()
  expect(settle).toHaveBeenCalledWith(
    lease,
    false,
    null,
    expect.any(Number),
    null,
  )
  expect(JSON.stringify(log.mock.calls)).not.toContain("private")
})

it("reports retained blocked notices after restart without including the queue body", async () => {
  claim.mockReset().mockReturnValue(null)
  health.mockReturnValue({
    pendingCount: 0,
    blockedCount: 1,
    oldestAgeMs: 60_000,
  })
  await drainAnalysisAudit()
  expect(log).toHaveBeenCalledExactlyOnceWith({
    event: "analysis_audit.queue.stalled",
    pendingCount: 0,
    blockedCount: 1,
    oldestAgeMs: 60_000,
  })
  expect(settle).not.toHaveBeenCalled()
})
