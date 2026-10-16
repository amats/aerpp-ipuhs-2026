import { expect, it } from "vitest"
import type { OperationalLogEntry } from "@/lib/cloud-logging-types"
import {
  buildOperationalSummary,
  describeOperationalEvent,
  maintenanceResult,
} from "./operational-log-summary"

function entry(
  overrides: Partial<OperationalLogEntry> = {},
): OperationalLogEntry {
  return {
    id: "one",
    timestamp: "2026-10-09T00:00:00Z",
    service: "web",
    severity: "INFO",
    event: null,
    operation: null,
    code: null,
    outcome: null,
    statusCode: null,
    counts: {},
    ...overrides,
  }
}
it("groups failures by service and cause with chronological boundaries, without counting retries as incidents", () => {
  const result = buildOperationalSummary([
    entry({
      event: "llm.analysis.failed",
      severity: "ERROR",
      timestamp: "2026-10-08T00:00:00Z",
    }),
    entry({ event: "dependency.request.retried", severity: "WARNING" }),
    entry({ event: "llm.analysis.failed", severity: "ERROR" }),
    entry({
      service: "support",
      operation: "mailHealth",
      code: "MAIL_REAUTHORIZATION_REQUIRED",
      severity: "ERROR",
    }),
  ])
  expect(result.attention).toHaveLength(2)
  expect(
    result.attention.find((item) => item.title === "解析失敗"),
  ).toMatchObject({
    count: 2,
    firstAt: "2026-10-08T00:00:00Z",
    lastAt: "2026-10-09T00:00:00Z",
  })
  expect(result.retryCount).toBe(1)
})
it.each([
  "ADMISSION_CLOSED",
  "WITHDRAWAL_CLEANUP_PENDING",
  "MAINTENANCE_OUTSIDE_WINDOW",
])("keeps expected %s separate from system failures", (code) => {
  expect(
    describeOperationalEvent(
      entry({ severity: "ERROR", code, statusCode: 503 }),
    ).kind,
  ).toBe("activity")
})
it.each([
  "step_state.validation.rejected",
  "llm.analysis.aborted",
  "http.request.rejected",
])("does not classify %s as an incident", (event) => {
  expect(
    describeOperationalEvent(entry({ event, severity: "WARNING" })).kind,
  ).toBe("activity")
})
it("requires an observed maintenance outcome and distinguishes skipped work and carried-over cleanup", () => {
  expect(maintenanceResult(undefined)).toBe("記録を確認できません")
  expect(maintenanceResult(entry({ code: "MAINTENANCE_OUTSIDE_WINDOW" }))).toBe(
    "対象期間外のスキップ",
  )
  expect(
    maintenanceResult(
      entry({ code: "MAINTENANCE_COMPLETED", counts: { pending: 1 } }),
    ),
  ).toBe("完了（処理持越しあり）")
  expect(maintenanceResult(entry({ counts: { failed: 1 } }))).toBe(
    "失敗・要確認",
  )
  expect(maintenanceResult(entry())).toBe("結果未確認")
})
it("does not expose unknown codes or event names, including object-prototype keys", () => {
  const result = buildOperationalSummary([
    entry({
      event: "private-data",
      operation: "constructor",
      code: "toString",
      severity: "ERROR",
    }),
  ])
  expect(JSON.stringify(result.attention)).not.toContain("private-data")
  expect(result.attention[0]).toMatchObject({
    title: "Web の運用記録",
    event: null,
    operation: null,
    code: null,
  })
})

it.each([
  { severity: "WARNING" as const },
  { event: "auth.participation_events.invalid_schema", outcome: "partial" },
  {
    service: "admin" as const,
    operation: "authenticateAdmin",
    code: "AUTHENTICATION_WARNING",
    severity: "WARNING" as const,
  },
])(
  "keeps unexplained warnings and partial reads visible for attention: %j",
  (overrides) => {
    expect(describeOperationalEvent(entry(overrides)).kind).toBe("attention")
  },
)

it.each([400, 401, 403, 404, 409, 410, 422])(
  "distinguishes dependency HTTP %s rejection from transport failure",
  (statusCode) => {
    expect(
      describeOperationalEvent(
        entry({
          event: "dependency.request.failed",
          outcome: "failed",
          severity: "WARNING",
          statusCode,
        }),
      ),
    ).toMatchObject({ kind: "activity", result: "拒否" })
  },
)

it.each([429, 500, 503])(
  "retains final dependency HTTP %s failures as attention",
  (statusCode) => {
    expect(
      describeOperationalEvent(
        entry({
          event: "dependency.request.failed",
          outcome: "failed",
          severity: "WARNING",
          statusCode,
        }),
      ).kind,
    ).toBe("attention")
  },
)

it("does not let a rejected outcome hide a system failure", () => {
  expect(
    describeOperationalEvent(
      entry({
        event: "http.request.rejected",
        outcome: "rejected",
        statusCode: 500,
      }),
    ).kind,
  ).toBe("attention")
})
