import { beforeEach, describe, expect, it, vi } from "vitest"

const { getEntries, getProjectId, createClient, logError, env } = vi.hoisted(
  () => ({
    getEntries: vi.fn(),
    getProjectId: vi.fn(),
    createClient: vi.fn(),
    logError: vi.fn(),
    env: {
      projectId: "synthetic-project" as string | undefined,
    },
  }),
)
vi.mock("server-only", () => ({}))
vi.mock("@/lib/google-auth", () => ({ googleClientOptions: env }))
vi.mock("pino", () => ({ default: () => ({ error: logError }) }))
vi.mock("@google-cloud/logging", () => ({
  Logging: class {
    constructor() {
      createClient()
    }
    auth = { getProjectId }
    getEntries = getEntries
  },
}))

import { listOperationalLogs, parseLogPeriodDays } from "./cloud-logging"

beforeEach(() => {
  vi.resetAllMocks()
  env.projectId = "synthetic-project"
  getProjectId.mockResolvedValue("synthetic-project")
  getEntries.mockResolvedValue([[]])
})

describe("Cloud Logging failure boundary", () => {
  it("never initializes cloud credentials or requests logs for emulator projects", async () => {
    env.projectId = "demo-admin-information"
    expect(await listOperationalLogs(1)).toMatchObject({
      entries: [],
      error: "ローカル検証環境では Cloud Logging を利用しません。",
    })
    expect(createClient).not.toHaveBeenCalled()
    expect(getProjectId).not.toHaveBeenCalled()
    expect(getEntries).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })

  it.each(["request", "initialization", "project resolution"])(
    "sanitizes %s failures in both UI and structured diagnostics",
    async (phase) => {
      const error = Object.assign(new Error("synthetic-secret-message"), {
        code: 7,
        details: "synthetic-private-email@example.invalid",
        metadata: { authorization: "synthetic-bearer-token" },
      })
      if (phase === "request") getEntries.mockRejectedValue(error)
      if (phase === "initialization")
        createClient.mockImplementation(() => {
          throw error
        })
      if (phase === "project resolution") {
        env.projectId = undefined
        getProjectId.mockRejectedValue(error)
      }
      const result = await listOperationalLogs(7)
      expect(result).toMatchObject({
        entries: [],
        error:
          "Cloud Logging を取得できませんでした。時間をおいて再試行してください。",
      })
      expect(logError).toHaveBeenCalledWith(
        { operation: "listOperationalLogs", status: 7 },
        "Cloud Logging request failed",
      )
      const output = JSON.stringify([result, logError.mock.calls])
      for (const value of [
        error.message,
        error.details,
        error.metadata.authorization,
      ])
        expect(output).not.toContain(value)
    },
  )

  it.each(["synthetic-sensitive-code", Infinity, 700, 1.5, undefined])(
    "omits unsupported SDK codes (%s) and private configuration",
    async (code) => {
      getEntries.mockRejectedValue({
        code,
        message: "private",
        details: "private",
      })
      await listOperationalLogs(1)
      expect(logError).toHaveBeenCalledWith(
        { operation: "listOperationalLogs", status: undefined },
        "Cloud Logging request failed",
      )
      expect(JSON.stringify(logError.mock.calls)).not.toContain("private")
      expect(getProjectId).not.toHaveBeenCalled()
    },
  )

  it("preserves successful log entries and the requested period", async () => {
    getEntries.mockResolvedValue([
      [
        {
          data: { message: "Synthetic operational event" },
          metadata: {
            insertId: "one",
            severity: "ERROR",
            timestamp: "2026-09-19T00:00:00Z",
            logName: "synthetic",
            resource: { type: "cloud_run_revision" },
          },
        },
      ],
    ])
    const result = await listOperationalLogs(7)
    expect(result.error).toBeNull()
    expect(result.entries[0]).toMatchObject({
      service: "support",
      severity: "ERROR",
      timestamp: "2026-09-19T00:00:00.000Z",
    })
    expect(getEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        autoPaginate: false,
        pageSize: 200,
        resourceNames: ["projects/synthetic-project"],
      }),
    )
    expect(logError).not.toHaveBeenCalled()
  })

  it("returns a stable missing-project error without querying logs", async () => {
    env.projectId = undefined
    getProjectId.mockResolvedValue(null)
    expect((await listOperationalLogs(1)).error).toContain("プロジェクト設定")
    expect(getEntries).not.toHaveBeenCalled()
  })
})

it.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])(
  "displays logs in Japan time under %s",
  async (timeZone) => {
    const previous = process.env.TZ
    try {
      process.env.TZ = timeZone
      getEntries.mockResolvedValue([
        [
          {
            data: "synthetic event",
            metadata: { timestamp: "2026-09-22T18:30:00Z" },
          },
        ],
      ])
      expect((await listOperationalLogs(1)).entries[0].timestamp).toBe(
        "2026-09-22T18:30:00.000Z",
      )
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  },
)

it.each([undefined, "1", "invalid", "0", ["7"], " 7", 7])(
  "defaults an unsupported period %s to one day",
  (value) => {
    expect(parseLogPeriodDays(value)).toBe(1)
  },
)
it.each(["7", "30"])("accepts period %s", (value) => {
  expect(parseLogPeriodDays(value)).toBe(Number(value))
})

it("paginates with a fixed window and independently reads the latest maintenance outcomes", async () => {
  getEntries.mockImplementation(async (query) => {
    if (query.filter.includes('jsonPayload.operation="')) return [[], null, {}]
    const event = {
      data: { event: "llm.analysis.started", outcome: "started" },
      metadata: { timestamp: "2026-10-08T12:00:00Z" },
    }
    return query.pageToken
      ? [[event], null, {}]
      : [[event], { pageToken: "next" }, {}]
  })
  const now = new Date("2026-10-09T00:00:00Z")
  const logs = await listOperationalLogs(7, now)
  expect(logs.entries).toHaveLength(2)
  expect(new Set(logs.entries.map((item) => item.id)).size).toBe(2)
  expect(logs.truncated).toBe(false)
  const queries = getEntries.mock.calls.map(([query]) => query)
  expect(queries).toHaveLength(4)
  expect(
    queries.every(
      (query) =>
        query.filter.includes('timestamp>="2026-10-02T00:00:00.000Z"') &&
        query.filter.includes('timestamp<="2026-10-09T00:00:00.000Z"'),
    ),
  ).toBe(true)
  expect(queries[0].filter).toContain('labels.component="app-aerpp"')
  expect(queries[0].filter).not.toContain("severity>=ERROR AND timestamp")
  expect(queries.filter((query) => query.pageSize === 1)).toHaveLength(2)
})

it("marks capped retrieval incomplete even if pages are empty but carry a next-page token", async () => {
  getEntries.mockImplementation(async (query) =>
    query.pageSize === 1
      ? [[], null, {}]
      : [[], null, { nextPageToken: "next" }],
  )
  const result = await listOperationalLogs(30)
  expect(result.truncated).toBe(true)
  expect(
    getEntries.mock.calls.filter(([query]) => query.pageSize === 200),
  ).toHaveLength(5)
})

it.each(["events", "maintenance"])(
  "isolates %s retrieval failures without inventing zero counts",
  async (failed) => {
    getEntries.mockImplementation(async (query) => {
      if ((query.pageSize === 200) === (failed === "events"))
        throw { code: 7, message: "private" }
      return [
        [
          {
            data: { operation: "mailHealth", code: "MAINTENANCE_COMPLETED" },
            metadata: {},
          },
        ],
        null,
        {},
      ]
    })
    const result = await listOperationalLogs(1)
    expect(result.error === null).toBe(failed !== "events")
    expect(result.maintenanceError === null).toBe(failed !== "maintenance")
    expect(
      failed === "events"
        ? result.maintenanceEntries.length
        : result.entries.length,
    ).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain("private")
  },
)

it("reads Support severity and protobuf timestamps while dropping unreviewed payload fields", async () => {
  getEntries.mockResolvedValue([
    [
      {
        data: {
          operation: "mailHealth",
          code: "MAIL_REAUTHORIZATION_REQUIRED",
          message: "private-message",
          email: "private@example.invalid",
          event: "sk_PRIVATE_TOKEN",
          scanned: 8,
          failed: 1,
          pending: -1,
          completed: "2",
        },
        metadata: {
          severity: "ERROR",
          timestamp: { seconds: "1791504000", nanos: 500000000 },
          resource: {
            type: "cloud_run_revision",
            labels: { service_name: "aerpp-support" },
          },
          httpRequest: { status: 503, requestUrl: "private-url" },
        },
      },
      { data: "private-body", metadata: { timestamp: "invalid" } },
    ],
    null,
    {},
  ])
  const result = await listOperationalLogs(1)
  expect(result.entries[0]).toMatchObject({
    service: "support",
    severity: "ERROR",
    event: null,
    operation: "mailHealth",
    code: "MAIL_REAUTHORIZATION_REQUIRED",
    timestamp: "2026-10-09T00:00:00.500Z",
    statusCode: 503,
    counts: { scanned: 8, failed: 1 },
  })
  expect(result.entries[1].timestamp).toBeNull()
  const serialized = JSON.stringify(result)
  for (const secret of [
    "private-message",
    "private@example.invalid",
    "sk_PRIVATE_TOKEN",
    "private-url",
    "private-body",
  ])
    expect(serialized).not.toContain(secret)
  expect(result.entries[0].counts).not.toHaveProperty("pending")
  expect(result.entries[0].counts).not.toHaveProperty("completed")
})

it("recognizes proxy string levels and retains only bounded HTTP status", async () => {
  getEntries.mockResolvedValue([
    [
      {
        data: {
          level: "error",
          status: 502,
          request: { headers: { authorization: "private" } },
        },
        metadata: {
          resource: { type: "generic_node" },
          labels: { component: "caddy" },
        },
      },
    ],
    null,
    {},
  ])
  const result = await listOperationalLogs(1)
  expect(result.entries[0]).toMatchObject({
    service: "proxy",
    severity: "ERROR",
    statusCode: 502,
  })
  expect(JSON.stringify(result)).not.toContain("private")
})

it.each([
  ["INFO", 200, "INFO"],
  ["WARNING", 400, "WARNING"],
  ["ERROR", 500, "ERROR"],
  ["CRITICAL", 600, "CRITICAL"],
])(
  "reads platform severity %s and its protobuf enum %s",
  async (label, value, expected) => {
    getEntries.mockResolvedValue([
      [label, value].map((severity) => ({
        data: {},
        metadata: { severity },
      })),
    ])
    const result = await listOperationalLogs(1)
    expect(result.entries.map((entry) => entry.severity)).toEqual([
      expected,
      expected,
    ])
  },
)

it("continues through empty maintenance pages before accepting an absent result", async () => {
  getEntries.mockImplementation(async (query) => {
    if (query.pageSize === 200) return [[], null, {}]
    if (query.pageToken !== "continue")
      return [[], null, { nextPageToken: "continue" }]
    const operation = query.filter.includes(
      'jsonPayload.operation="mailHealth"',
    )
      ? "mailHealth"
      : "withdrawalCleanup"
    return [
      [{ data: { operation, code: "MAINTENANCE_COMPLETED" }, metadata: {} }],
      null,
      {},
    ]
  })
  const result = await listOperationalLogs(1)
  expect(result.maintenanceError).toBeNull()
  expect(
    result.maintenanceEntries.map((entry) => entry.operation).sort(),
  ).toEqual(["mailHealth", "withdrawalCleanup"])
  expect(
    getEntries.mock.calls.filter(([query]) => query.pageSize === 1),
  ).toHaveLength(4)
})

it("keeps one maintenance result when the other operation is unavailable", async () => {
  getEntries.mockImplementation(async (query) => {
    if (query.pageSize === 200) return [[], null, {}]
    if (query.filter.includes('jsonPayload.operation="mailHealth"'))
      throw new Error("private")
    return [
      [
        {
          data: {
            operation: "withdrawalCleanup",
            code: "MAINTENANCE_COMPLETED",
          },
          metadata: {},
        },
      ],
      null,
      {},
    ]
  })
  const result = await listOperationalLogs(1)
  expect(result.error).toBeNull()
  expect(result.maintenanceError).not.toBeNull()
  expect(result.maintenanceEntries).toHaveLength(1)
  expect(result.maintenanceEntries[0].operation).toBe("withdrawalCleanup")
})

it("reports unavailable maintenance after reaching the continuation cap", async () => {
  getEntries.mockImplementation(async (query) =>
    query.pageSize === 200
      ? [[], null, {}]
      : [[], { pageToken: "continue" }, {}],
  )
  const result = await listOperationalLogs(1)
  expect(result.maintenanceEntries).toEqual([])
  expect(result.maintenanceError).not.toBeNull()
  expect(
    getEntries.mock.calls.filter(([query]) => query.pageSize === 1),
  ).toHaveLength(10)
})

it("drops non-string outcomes without invoking untrusted coercion", async () => {
  getEntries.mockResolvedValue([
    [
      {
        data: {
          outcome: {
            toString() {
              throw new Error("private")
            },
          },
        },
        metadata: {},
      },
    ],
  ])
  const result = await listOperationalLogs(1)
  expect(result.error).toBeNull()
  expect(result.entries[0].outcome).toBeNull()
})
