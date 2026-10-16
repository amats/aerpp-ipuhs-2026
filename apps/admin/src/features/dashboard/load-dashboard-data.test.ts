import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({ env: mocks.env }))
const mocks = vi.hoisted(() => ({
  env: { participantApiServerId: "selected" },
  get: vi.fn(),
  listInformation: vi.fn(),
  logInformationFailure: vi.fn(),
  listOperationalLogs: vi.fn(),
}))
vi.mock("@/lib/firestore", () => ({
  firestore: {
    collection: (name: string) => ({
      select: () => ({ get: () => mocks.get(name) }),
    }),
  },
}))
vi.mock("@/lib/cloud-logging", () => ({
  listOperationalLogs: mocks.listOperationalLogs,
}))
vi.mock("@/lib/logger", () => ({
  logInformationFailure: mocks.logInformationFailure,
}))
vi.mock("@/features/information/information-service", () => ({
  informationRepository: () => ({ list: mocks.listInformation }),
}))

import { loadDashboardData } from "./load-dashboard-data"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.env.participantApiServerId = "selected"
  mocks.listInformation.mockResolvedValue([])
  mocks.listOperationalLogs.mockResolvedValue({
    entries: [],
    maintenanceEntries: [],
    error: null,
    maintenanceError: null,
    truncated: false,
    since: "2026-10-01T00:00:00.000Z",
    until: "2026-10-02T00:00:00.000Z",
  })
  mocks.get.mockImplementation(async (name: string) => ({
    docs: (name === "participationEvents"
      ? [1, 2, 3, 4, 5, 6]
      : name === "analysisQuestionnaires"
        ? [7, 8]
        : []
    ).map((id) => ({
      id: String(id),
      data: () => ({
        pseudonym: `synthetic-${id}`,
        serverId: id === 6 ? "other" : "selected",
        dataPurpose: id === 5 ? "test" : "research",
        eventType: "consent",
        [name === "participationEvents" ? "consentConfirmedAt" : "createdAt"]:
          new Date(id * 1000),
        ...(id === 7 ? { submittedAt: new Date(7000) } : {}),
      }),
    })),
  }))
})

it("previews four latest filtered updates and excludes unsubmitted analysisQuestionnaires", async () => {
  const data = await loadDashboardData({})
  expect(data.recentActivity.map((item) => item.id)).toEqual([
    "survey-7",
    "consent-4",
    "consent-3",
    "consent-2",
  ])
  expect(mocks.get.mock.calls).toEqual([
    ["participationEvents"],
    ["analysisQuestionnaires"],
    ["analysisAttempts"],
  ])
})

it("retains the configured server when all data purposes are requested", async () => {
  const data = await loadDashboardData({ dataPurpose: "all" })
  expect(data.recentActivity.map((item) => item.id)).toEqual([
    "survey-7",
    "consent-5",
    "consent-4",
    "consent-3",
  ])
})

it("returns no activity for a server without matching records", async () => {
  mocks.env.participantApiServerId = "empty"
  const data = await loadDashboardData({})
  expect(data.recentActivity).toEqual([])
  expect(data.attemptCounts).toEqual({
    total: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    unconfirmed: 0,
  })
})

it.each([
  [
    "research",
    { total: 205, completed: 202, failed: 1, cancelled: 1, unconfirmed: 1 },
  ],
  ["test", { total: 1, completed: 0, failed: 1, cancelled: 0, unconfirmed: 0 }],
  [
    "unclassified",
    { total: 1, completed: 0, failed: 0, cancelled: 0, unconfirmed: 1 },
  ],
  [
    "all",
    { total: 207, completed: 202, failed: 2, cancelled: 1, unconfirmed: 2 },
  ],
] as const)(
  "counts all retained attempts for %s within the configured server",
  async (dataPurpose, expected) => {
    const attempts = [
      ...Array.from({ length: 205 }, (_, index) => ({
        serverId: "selected",
        dataPurpose: "research",
        outcome: ["failed", "cancelled", "unconfirmed"][index] ?? "completed",
      })),
      { serverId: "selected", dataPurpose: "test", outcome: "failed" },
      { serverId: "selected", outcome: "unknown" },
      { serverId: "other", dataPurpose: "research", outcome: "completed" },
    ]
    mocks.get.mockImplementation(async (name: string) => ({
      docs: (name === "analysisAttempts" ? attempts : []).map(
        (data, index) => ({
          id: String(index),
          data: () => data,
        }),
      ),
    }))
    const data = await loadDashboardData({ dataPurpose })
    expect(data.attemptCounts).toEqual(expected)
    expect(data.surveySummary.totalAnalyses).toBe(0)
  },
)

it("does not infer attempts from completed-analysis metadata", async () => {
  const data = await loadDashboardData({})
  expect(data.surveySummary.totalAnalyses).toBe(2)
  expect(data.attemptCounts.total).toBe(0)
})

it.each(["research", "test", "unclassified"])(
  "includes another server's %s withdrawal in the monitored participant's current state",
  async (purpose) => {
    mocks.get.mockImplementation(async (name: string) => ({
      docs:
        name !== "participationEvents"
          ? []
          : [
              {
                id: "consent",
                data: () => ({
                  pseudonym: "participant",
                  serverId: "selected",
                  dataPurpose: "research",
                  eventType: "consent",
                  consentConfirmedAt: new Date(1000),
                }),
              },
              {
                id: "withdrawal",
                data: () => ({
                  pseudonym: "participant",
                  serverId: "other",
                  dataPurpose: purpose,
                  eventType: "withdrawal",
                  withdrawalAcceptedAt: new Date(2000),
                }),
              },
            ],
    }))
    const data = await loadDashboardData({})
    expect(data.participantSummary.latestStatusCounts).toEqual([
      { eventType: "withdrawal", count: 1 },
    ])
    expect(data.participantSummary.trackedParticipants).toBe(1)
    expect(data.recentActivity.map((item) => item.id)).toEqual([
      "consent-consent",
    ])
  },
)

it("shows environment-wide notices independently of data purpose and fixes logs to one day", async () => {
  const notice = { id: "notice", content: "Synthetic notice", tone: "info" }
  mocks.listInformation.mockResolvedValue([notice])
  const data = await loadDashboardData({
    dataPurpose: "test",
  })
  expect(data.information).toEqual([notice])
  expect(data.informationError).toBeNull()
  expect(mocks.listOperationalLogs).toHaveBeenCalledWith(1)
})

it("keeps other cards available when notice retrieval fails without exposing SDK errors", async () => {
  const error = new Error("private-provider-detail")
  mocks.listInformation.mockRejectedValue(error)
  const data = await loadDashboardData({})
  expect(data.information).toEqual([])
  expect(data.informationError).toContain("お知らせを取得できませんでした")
  expect(JSON.stringify(data)).not.toContain("private-provider-detail")
  expect(data.recentActivity).toHaveLength(4)
  expect(mocks.logInformationFailure).toHaveBeenCalledWith(
    "listInformation",
    error,
  )
})
