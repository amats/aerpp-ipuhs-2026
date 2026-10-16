import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: { participantApiServerId: "selected" },
}))
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("@/lib/firestore", () => ({
  firestore: { collection: () => ({ select: () => ({ get }) }) },
}))

import { loadParticipantPageData } from "./load-participant-page-data"

function consent(
  id: string,
  serverId: string,
  eventType: string,
  time: number,
  pseudonym = "participant",
  dataPurpose = "research",
) {
  return {
    id,
    data: () => ({
      serverId,
      eventType,
      [eventType === "consent" ? "consentConfirmedAt" : "withdrawalAcceptedAt"]:
        new Date(time),
      pseudonym,
      dataPurpose,
    }),
  }
}

beforeEach(() => vi.resetAllMocks())

it("reflects Firestore withdrawal and renewed consent on each load while retaining the monitored server scope", async () => {
  const original = consent("consent-a", "selected", "consent", 1000)
  const unrelated = consent(
    "unrelated",
    "other",
    "consent",
    2000,
    "other-participant",
  )
  get.mockResolvedValue({ docs: [original, unrelated] })
  expect((await loadParticipantPageData()).summary.latestStatusCounts).toEqual([
    { eventType: "consent", count: 1 },
  ])

  const withdrawal = consent("withdrawal-b", "other", "withdrawal", 3000)
  get.mockResolvedValue({ docs: [original, unrelated, withdrawal] })
  const reloaded = await loadParticipantPageData()
  expect(reloaded.summary).toEqual({
    totalRecords: 1,
    trackedParticipants: 1,
    latestStatusCounts: [{ eventType: "withdrawal", count: 1 }],
  })
  expect(reloaded.records.map((record) => record.id)).toEqual(["consent-a"])

  get.mockResolvedValue({
    docs: [
      original,
      unrelated,
      withdrawal,
      consent("renewed-b", "other", "consent", 4000),
    ],
  })
  expect((await loadParticipantPageData()).summary.latestStatusCounts).toEqual([
    { eventType: "consent", count: 1 },
  ])
  expect(get).toHaveBeenCalledTimes(3)
})

it("keeps data-purpose selection and excludes participants outside the server scope", async () => {
  get.mockResolvedValue({
    docs: [consent("other", "other", "withdrawal", 2000)],
  })
  expect(
    (await loadParticipantPageData("all")).summary.trackedParticipants,
  ).toBe(0)
  get.mockResolvedValue({
    docs: [consent("selected", "selected", "consent", 1000)],
  })
  expect(
    (await loadParticipantPageData("test")).summary.trackedParticipants,
  ).toBe(0)
})

it.each(["test", "unclassified"])(
  "includes %s history in the current state without adding its records to research views",
  async (purpose) => {
    const original = consent("consent", "selected", "consent", 1000)
    const withdrawal = consent(
      "withdrawal",
      "other",
      "withdrawal",
      2000,
      "participant",
      purpose,
    )
    const unrelated = consent(
      "unrelated",
      "selected",
      "consent",
      3000,
      "test-only",
      purpose,
    )
    get.mockResolvedValue({ docs: [original, withdrawal, unrelated] })
    const data = await loadParticipantPageData()
    expect(data.summary).toEqual({
      totalRecords: 1,
      trackedParticipants: 1,
      latestStatusCounts: [{ eventType: "withdrawal", count: 1 }],
    })
    expect(data.records.map((record) => record.id)).toEqual(["consent"])
    expect(data.recentActivity.map((record) => record.id)).toEqual([
      "consent-consent",
    ])

    get.mockResolvedValue({
      docs: [
        original,
        withdrawal,
        unrelated,
        consent("renewed", "other", "consent", 4000, "participant", purpose),
      ],
    })
    expect(
      (await loadParticipantPageData()).summary.latestStatusCounts,
    ).toEqual([{ eventType: "consent", count: 1 }])
  },
)

vi.mock("./load-recovery-authorizations", () => ({
  loadRecoveryAuthorizations: async () => [],
}))
