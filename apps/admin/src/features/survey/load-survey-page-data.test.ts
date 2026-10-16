import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({
  env: { participantApiServerId: "selected" },
}))
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("@/lib/firestore", () => ({
  firestore: {
    collection: (name: string) => ({
      select: () => ({ get: () => get(name) }),
    }),
  },
}))

import { loadSurveyPageData } from "./load-survey-page-data"

beforeEach(() => vi.resetAllMocks())

it("aggregates all filtered completed metadata before truncation, including unanswered records without attempts", async () => {
  const records = [
    ...Array.from({ length: 205 }, (_, index) => ({
      processingDurationSeconds: index,
    })),
    ...[null, "", "invalid", -1, Number.NaN, Infinity, false, undefined].map(
      (processingDurationSeconds) => ({ processingDurationSeconds }),
    ),
    { processingDurationSeconds: 10000, serverId: "other" },
    { processingDurationSeconds: 500, dataPurpose: "test" },
    { processingDurationSeconds: 600, dataPurpose: undefined },
  ]
  get.mockImplementation(async (name: string) => ({
    docs:
      name === "analysisQuestionnaires"
        ? records.map((record, index) => ({
            id: `survey-${index}`,
            data: () => ({
              serverId: "selected",
              dataPurpose: "research",
              ...record,
            }),
          }))
        : [],
  }))

  const research = await loadSurveyPageData()
  expect(research.records).toHaveLength(200)
  expect(research.summary.totalResponses).toBe(0)
  expect(research.summary.totalAnalyses).toBe(213)
  expect(research.analysisTimeDistribution.validCount).toBe(205)
  expect(research.analysisTimeDistribution.unknownCount).toBe(8)
  expect(research.analysisTimeDistribution.bins.at(-1)?.upperSec).toBe(204)
  expect(
    research.analysisTimeDistribution.bins.reduce(
      (total, bin) => total + bin.count,
      0,
    ),
  ).toBe(205)

  const all = await loadSurveyPageData("all")
  expect(all.analysisTimeDistribution.validCount).toBe(207)
  expect(all.analysisTimeDistribution.bins.at(-1)?.upperSec).toBe(600)
  const test = await loadSurveyPageData("test")
  expect(test.analysisTimeDistribution.bins).toEqual([
    { lowerSec: 500, upperSec: 500, count: 1 },
  ])

  // Each reload reads fresh snapshots; attempts never supply missing survey time.
  get.mockImplementation(async (name: string) => ({
    docs:
      name === "analysisAttempts"
        ? [
            {
              id: "attempt-only",
              data: () => ({
                serverId: "selected",
                dataPurpose: "research",
                durationMs: 12000,
              }),
            },
          ]
        : [],
  }))
  expect((await loadSurveyPageData()).analysisTimeDistribution).toEqual({
    bins: [],
    method: "none",
    validCount: 0,
    unknownCount: 0,
  })
})
