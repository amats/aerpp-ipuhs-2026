import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  logs: vi.fn(),
  events: vi.fn(),
  attempts: vi.fn(),
  surveys: vi.fn(),
  failure: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/monitoring/participant-records", () => ({
  getConfiguredServerId: () => "fixed-server",
  loadParticipationEventRecords: mocks.events,
  loadAnalysisAttempts: mocks.attempts,
  loadSurveyRecords: mocks.surveys,
}))
vi.mock("@/lib/cloud-logging", () => ({
  listOperationalLogs: mocks.logs,
  parseLogPeriodDays: (period: unknown) => (period === "7" ? 7 : 1),
}))
vi.mock("@/lib/logger", () => ({ logPageDataFailure: mocks.failure }))

import { loadOperationalPageData } from "./load-operational-page-data"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.events.mockResolvedValue([])
  mocks.attempts.mockResolvedValue([])
  mocks.surveys.mockResolvedValue([])
  mocks.logs.mockResolvedValue({
    entries: [],
    maintenanceEntries: [],
    truncated: false,
    error: null,
    maintenanceError: null,
  })
})
it.each([undefined, "test", "all", "unclassified"])(
  "scopes usage to the fixed server and %s purpose while keeping logs environment-wide",
  async (purpose) => {
    const now = new Date("2026-10-09T00:00:00Z")
    const result = await loadOperationalPageData(
      { period: "7", dataPurpose: purpose },
      now,
    )
    expect(result.filters).toEqual({
      serverId: "fixed-server",
      periodDays: 7,
      dataPurpose: purpose ?? "research",
    })
    expect(mocks.events).toHaveBeenCalledWith(
      "fixed-server",
      purpose ?? "research",
    )
    expect(mocks.attempts).toHaveBeenCalledWith(
      "fixed-server",
      purpose ?? "research",
    )
    expect(mocks.surveys).toHaveBeenCalledWith(
      "fixed-server",
      purpose ?? "research",
      [],
      { includeAnswers: false },
    )
    expect(mocks.logs).toHaveBeenCalledWith(7, now)
    expect(result.usage.ok).toBe(true)
  },
)
it("keeps logs visible on Firestore failure and returns a failure instead of invented zero utilization", async () => {
  mocks.attempts.mockRejectedValue(new Error("private"))
  const result = await loadOperationalPageData({})
  expect(result.usage).toEqual({ ok: false })
  expect(result.logs.error).toBeNull()
  expect(mocks.failure).toHaveBeenCalledWith(
    "loadOperationalUsage",
    expect.any(Error),
  )
  expect(JSON.stringify(result)).not.toContain("private")
})
it("keeps utilization visible when logs are unavailable", async () => {
  mocks.logs.mockResolvedValue({
    entries: [],
    maintenanceEntries: [],
    truncated: false,
    error: "unavailable",
    maintenanceError: "unavailable",
  })
  const result = await loadOperationalPageData({})
  expect(result.usage.ok).toBe(true)
  expect(result.logs.error).toBe("unavailable")
})
