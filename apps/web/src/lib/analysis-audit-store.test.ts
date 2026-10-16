import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, expect, it } from "vitest"
import { createAnalysisAuditStore } from "./analysis-audit-store"
import { setAnalysisOperation } from "./session-authority"

const connections: DatabaseSync[] = []
const directories: string[] = []
const body = {
  analysisId: "analysis",
  serverId: "server",
  clientId: "client",
  pseudonym: "person",
  consentId: "consent",
  outcome: "completed" as const,
  endedAtMs: 2000,
}
function open(path = ":memory:") {
  const db = new DatabaseSync(path)
  connections.push(db)
  return db
}
afterEach(() => {
  for (const db of connections.splice(0)) db.close()
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true })
})
it("survives reopening, leases across workers, and rejects stale acknowledgments", () => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-audit-test-"))
  directories.push(directory)
  const path = join(directory, "audit.sqlite")
  const first = createAnalysisAuditStore(open(path))
  first.enqueue(body, 0)
  const second = createAnalysisAuditStore(open(path))
  const lease = second.claim(30_000)
  expect(lease?.body).toEqual(body)
  expect(first.claim(30_001)).toBeNull()
  const renewed = first.claim(90_001)
  expect(renewed?.body).toEqual(body)
  if (!lease || !renewed) throw new Error("missing lease")
  second.settle(lease, true, 200)
  expect(first.counts()).toEqual([{ status: "pending", count: 1 }])
  first.settle(renewed, true, 200)
  expect(first.counts()).toEqual([])
})
it("preserves queued evidence on conflict and blocks permanent rejection without eviction", () => {
  const store = createAnalysisAuditStore(open())
  store.enqueue(body, 0)
  store.enqueue(body, 1)
  expect(() => store.enqueue({ ...body, outcome: "failed" }, 2)).toThrow(
    "CONFLICT",
  )
  const lease = store.claim(30_000)
  if (!lease) throw new Error("missing lease")
  store.settle(lease, false, 409, 30_000)
  expect(store.counts()).toEqual([{ status: "blocked", count: 1 }])
  expect(store.claim(999_999)).toBeNull()
})
it("retries transient failure and permits exact normal-delivery acknowledgment", () => {
  const store = createAnalysisAuditStore(open())
  store.enqueue(body, 0)
  const lease = store.claim(30_000)
  if (!lease) throw new Error("missing lease")
  store.settle(lease, false, 503, 30_000)
  expect(store.claim(34_999)).toBeNull()
  expect(store.claim(36_000)?.attempts).toBe(2)
  store.acknowledge(body)
  expect(store.counts()).toEqual([])
})
it("rejects research or contact fields before any persistence", () => {
  const db = open()
  const store = createAnalysisAuditStore(db)
  for (const extra of [
    { durationMs: 1000 },
    { encryptedEmail: "cipher" },
    { documentGraphemeCounts: [1] },
    { answers: {} },
    { model: "model" },
  ]) {
    expect(() => store.enqueue({ ...body, ...extra })).toThrow()
  }
  expect(db.prepare("SELECT * FROM analysis_audit_outbox").all()).toEqual([])
})

it("quarantines malformed retained data and continues to later valid notices", () => {
  const db = open()
  const store = createAnalysisAuditStore(db)
  db.prepare(
    "INSERT INTO analysis_audit_outbox (id, payload, queuedAt, nextAttemptAt) VALUES (?, ?, 0, 0)",
  ).run("corrupt", "{")
  store.enqueue(body, 1)
  expect(store.claim(30_001)).toBeNull()
  expect(store.claim(30_001)?.body).toEqual(body)
  expect(store.counts()).toEqual(
    expect.arrayContaining([{ status: "blocked", count: 1 }]),
  )
})
it("refuses insertion at capacity without deleting existing evidence", () => {
  const db = open()
  const store = createAnalysisAuditStore(db)
  db.exec("BEGIN IMMEDIATE")
  const insert = db.prepare(
    "INSERT INTO analysis_audit_outbox (id, payload, queuedAt, nextAttemptAt) VALUES (?, ?, 0, 0)",
  )
  for (let index = 0; index < 10_000; index += 1)
    insert.run(String(index), JSON.stringify(body))
  db.exec("COMMIT")
  expect(() => store.assertWritable()).toThrow("AUDIT_OUTBOX_FULL")
  expect(() => store.enqueue(body)).toThrow("AUDIT_OUTBOX_FULL")
  expect(store.counts()).toEqual([{ status: "pending", count: 10_000 }])
})

it("checks write availability without adding or changing operational evidence", () => {
  const db = open()
  const store = createAnalysisAuditStore(db)
  store.enqueue(body, 0)
  const before = db.prepare("SELECT * FROM analysis_audit_outbox").all()
  store.assertWritable()
  expect(db.prepare("SELECT * FROM analysis_audit_outbox").all()).toEqual(
    before,
  )
  db.exec("PRAGMA query_only = ON")
  expect(() => store.assertWritable()).toThrow()
  db.exec("PRAGMA query_only = OFF")
  expect(() => store.assertWritable()).not.toThrow()
})

it("commits the matching checkpoint and outbox together and rolls both back on failure", () => {
  const db = open()
  const store = createAnalysisAuditStore(db)
  db.exec(
    "CREATE TABLE analysis_operations (sessionId TEXT PRIMARY KEY, attemptHash TEXT, outcome TEXT, expires INTEGER, executionOwner TEXT)",
  )
  const hash = createHash("sha256")
    .update(`session\0${body.analysisId}`)
    .digest("hex")
  db.prepare(
    "INSERT INTO analysis_operations VALUES (?, ?, 'running', 9999999999999, 'owner')",
  ).run("session", hash)
  expect(() =>
    store.enqueue(body, 0, (connection) => {
      setAnalysisOperation("session", body.analysisId, "completed", connection)
      throw new Error("checkpoint failed")
    }),
  ).toThrow("checkpoint failed")
  expect(store.counts()).toEqual([])
  expect(
    db.prepare("SELECT outcome FROM analysis_operations").get()?.outcome,
  ).toBe("running")
  store.enqueue(body, 0, (connection) =>
    setAnalysisOperation("session", body.analysisId, "completed", connection),
  )
  expect(store.counts()).toEqual([{ status: "pending", count: 1 }])
  expect(
    db.prepare("SELECT outcome FROM analysis_operations").get()?.outcome,
  ).toBe("completed")
  db.prepare(
    "UPDATE analysis_operations SET attemptHash='replacement', outcome='running'",
  ).run()
  store.enqueue(body, 1, (connection) =>
    setAnalysisOperation("session", body.analysisId, "completed", connection),
  )
  expect(
    db.prepare("SELECT outcome FROM analysis_operations").get()?.outcome,
  ).toBe("running")
  db.prepare("DELETE FROM analysis_operations").run()
  store.enqueue(body, 2, (connection) =>
    setAnalysisOperation("session", body.analysisId, "completed", connection),
  )
  expect(db.prepare("SELECT * FROM analysis_operations").all()).toEqual([])
})

it.each([401, 403])(
  "retains authentication failures for delivery after credentials are repaired (%s)",
  (code) => {
    const store = createAnalysisAuditStore(open())
    store.enqueue(body, 0)
    const lease = store.claim(30_000)
    if (!lease) throw new Error("missing lease")
    store.settle(lease, false, code, 30_000)
    expect(store.counts()).toEqual([{ status: "pending", count: 1 }])
    expect(store.claim(329_999)).toBeNull()
    expect(store.claim(330_000)?.attempts).toBe(2)
  },
)

it("honors Retry-After beyond the normal backoff cap without removing evidence", () => {
  const store = createAnalysisAuditStore(open())
  store.enqueue(body, 0)
  const lease = store.claim(30_000)
  if (!lease) throw new Error("missing lease")
  store.settle(lease, false, 429, 30_000, "600")
  expect(store.claim(629_999)).toBeNull()
  expect(store.claim(630_000)?.attempts).toBe(2)
})

it("reports only queue counts and oldest age, including retained blocked notices", () => {
  const store = createAnalysisAuditStore(open())
  expect(store.health(60_000)).toEqual({
    pendingCount: 0,
    blockedCount: 0,
    oldestAgeMs: 0,
  })
  store.enqueue(body, 1000)
  expect(store.health(61_000)).toEqual({
    pendingCount: 1,
    blockedCount: 0,
    oldestAgeMs: 60_000,
  })
  const lease = store.claim(31_000)
  if (!lease) throw new Error("missing lease")
  store.settle(lease, false, 409, 31_000)
  expect(store.health(61_000)).toEqual({
    pendingCount: 0,
    blockedCount: 1,
    oldestAgeMs: 60_000,
  })
})
