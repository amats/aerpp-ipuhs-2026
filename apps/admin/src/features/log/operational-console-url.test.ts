import { beforeEach, expect, it, vi } from "vitest"
import type { OperationalGroup } from "./operational-log-types"

const env = vi.hoisted(() => ({
  environment: "test",
  gcpProjectId: "synthetic-project" as string | undefined,
}))
vi.mock("server-only", () => ({}))
vi.mock("@aerpp/config/server/admin", () => ({ env }))

import { operationalConsoleUrl } from "./operational-console-url"
import { operationalLogQuery } from "./operational-log-query"
import { buildOperationalSummary } from "./operational-log-summary"

beforeEach(() => {
  env.environment = "test"
  env.gcpProjectId = "synthetic-project"
})
it("encodes the selected window and event context in the Logs Explorer route without opening the Console", () => {
  const since = "2026-10-08T00:00:00.000Z"
  const until = "2026-10-09T00:00:00.000Z"
  const group: OperationalGroup = {
    key: "one",
    service: "support",
    title: "メール基盤点検",
    result: "要確認",
    count: 1,
    firstAt: until,
    lastAt: until,
    event: null,
    operation: "mailHealth",
    code: "MAIL_REAUTHORIZATION_REQUIRED",
    statusCode: null,
  }
  const url = new URL(operationalConsoleUrl(since, until, group) as string)
  expect(url.origin).toBe("https://console.cloud.google.com")
  expect(url.searchParams.get("project")).toBe("synthetic-project")
  expect(url.pathname).toContain("/logs/query;query=")
  expect(url.pathname).not.toMatch(/[()]/)
  expect(url.pathname).toContain("%28")
  expect(url.pathname).toContain("%29")
  const query = decodeURIComponent(url.pathname.split(";query=")[1])
  expect(query).toBe(operationalLogQuery(since, until, group))
  for (const value of [
    since,
    until,
    'labels."aerpp-component"="support"',
    'jsonPayload.operation="mailHealth"',
    'jsonPayload.code="MAIL_REAUTHORIZATION_REQUIRED"',
  ])
    expect(query).toContain(value)
})
it.each(["example", "development"])(
  "hides Console links for %s environments",
  (environment) => {
    env.environment = environment
    expect(operationalConsoleUrl("since", "until")).toBeNull()
  },
)
it("hides Console links without a selected project", () => {
  env.gcpProjectId = undefined
  expect(operationalConsoleUrl("since", "until")).toBeNull()
})

it.each([401, 403, 404, 409, 429, 503])(
  "retains and links HTTP %s groups to the status in payload and platform request logs",
  (statusCode) => {
    const since = "2026-10-08T00:00:00.000Z"
    const until = "2026-10-09T00:00:00.000Z"
    const { attention } = buildOperationalSummary([
      {
        id: "request",
        timestamp: until,
        service: "support",
        severity: statusCode >= 500 ? "ERROR" : "WARNING",
        event: null,
        operation: null,
        code: null,
        outcome: null,
        statusCode,
        counts: {},
      },
    ])
    expect(attention).toHaveLength(1)
    expect(attention[0].statusCode).toBe(statusCode)
    const url = new URL(
      operationalConsoleUrl(since, until, attention[0]) as string,
    )
    const query = decodeURIComponent(url.pathname.split(";query=")[1])
    expect(query).toBe(operationalLogQuery(since, until, attention[0]))
    expect(query).toContain('labels."aerpp-component"="support"')
    expect(query).toContain(`jsonPayload.statusCode=${statusCode}`)
    expect(query).toContain(`jsonPayload.responseStatus=${statusCode}`)
    expect(query).toContain(`jsonPayload.status=${statusCode}`)
    expect(query).toContain(
      `(NOT jsonPayload.statusCode:* OR jsonPayload.statusCode=NULL_VALUE) AND (NOT jsonPayload.responseStatus:* OR jsonPayload.responseStatus=NULL_VALUE) AND (NOT jsonPayload.status:* OR jsonPayload.status=NULL_VALUE) AND httpRequest.status=${statusCode}`,
    )
    expect(query).toContain("severity>=WARNING")
  },
)

it("keeps transport failures without an HTTP response separate from HTTP rejection groups", () => {
  const { attention } = buildOperationalSummary([
    {
      id: "transport",
      timestamp: "2026-10-09T00:00:00.000Z",
      service: "web",
      severity: "ERROR",
      event: "dependency.request.failed",
      operation: null,
      code: null,
      outcome: "failed",
      statusCode: null,
      counts: {},
    },
  ])
  const query = operationalLogQuery("since", "until", attention[0])
  expect(query).toContain('jsonPayload.event="dependency.request.failed"')
  expect(query).toContain("AND NOT ((")
  expect(query).toContain(
    "jsonPayload.statusCode>=100 AND jsonPayload.statusCode<=599",
  )
  expect(query).toContain("httpRequest.status>=100 AND httpRequest.status<=599")
})
