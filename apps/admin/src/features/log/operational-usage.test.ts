import { expect, it } from "vitest"
import type {
  AnalysisAttemptRecord,
  ParticipationEventRecord,
  SurveyRecord,
} from "@/features/monitoring/participant-record-types"
import { buildOperationalUsage } from "./operational-usage"

it("uses event/attempt/submission timestamps independently and counts outcomes by attempt start in Japan time", () => {
  const result = buildOperationalUsage({
    since: new Date("2026-10-07T18:00:00Z"),
    until: new Date("2026-10-08T18:00:00Z"),
    events: [
      { eventType: "consent", eventAt: new Date("2026-10-07T19:00:00Z") },
      { eventType: "withdrawal", eventAt: new Date("2026-10-08T16:00:00Z") },
      {
        eventType: "recovery_authorized",
        eventAt: new Date("2026-10-08T17:00:00Z"),
      },
      { eventType: "consent", eventAt: new Date("2026-10-07T17:00:00Z") },
      { eventType: "consent", eventAt: null },
    ] as ParticipationEventRecord[],
    attempts: [
      { startedAt: new Date("2026-10-08T10:00:00Z"), outcome: "completed" },
      { startedAt: new Date("2026-10-08T11:00:00Z"), outcome: "failed" },
      { startedAt: new Date("2026-10-08T12:00:00Z"), outcome: "cancelled" },
      { startedAt: new Date("2026-10-08T17:00:00Z"), outcome: "unconfirmed" },
      { startedAt: new Date("2026-10-07T17:00:00Z"), outcome: "completed" },
      { startedAt: null, outcome: "failed" },
    ] as AnalysisAttemptRecord[],
    surveys: [
      {
        createdAt: new Date("2026-10-07T17:00:00Z"),
        submittedAt: new Date("2026-10-08T17:00:00Z"),
      },
      { createdAt: new Date("2026-10-08T18:00:00Z"), submittedAt: null },
      { createdAt: null, submittedAt: null },
      {
        createdAt: new Date("2026-10-08T19:00:00Z"),
        submittedAt: new Date("2026-10-08T19:00:00Z"),
      },
    ] as SurveyRecord[],
  })
  expect(result.counts).toEqual({
    consents: 1,
    withdrawals: 1,
    starts: 4,
    completed: 1,
    failed: 1,
    cancelled: 1,
    unconfirmed: 1,
    analyses: 1,
    responses: 1,
  })
  expect(result.unknownDates).toBe(3)
  expect(result.daily.map((row) => row.date)).toEqual([
    "2026-10-08",
    "2026-10-09",
  ])
  expect(result.daily[0].counts.starts).toBe(3)
  expect(result.daily[1].counts.responses).toBe(1)
  expect(result.daily[1].counts.analyses).toBe(1)
})

it("retains zero-activity days and never infers old attempts from analysis metadata", () => {
  const result = buildOperationalUsage({
    since: new Date("2026-10-01T15:00:00Z"),
    until: new Date("2026-10-03T15:00:00Z"),
    events: [],
    attempts: [],
    surveys: [
      { createdAt: new Date("2026-10-02T00:00:00Z"), submittedAt: null },
    ] as SurveyRecord[],
  })
  expect(result.daily).toHaveLength(3)
  expect(result.counts.starts).toBe(0)
  expect(result.counts.analyses).toBe(1)
  expect(result.counts.responses).toBe(0)
  expect(result.daily[1].counts.analyses).toBe(0)
})
