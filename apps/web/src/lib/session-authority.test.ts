import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  createAuthority,
  createOperationId,
  readAuthority,
  revokeAuthority,
  updateAuthority,
  watchAuthority,
} from "./session-authority"
import { SESSION_AUTHORITY_CONSTRAINTS as limits } from "./session-authority-constraints"

const now = Date.now()
let db: DatabaseSync

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  if (!db) {
    createAuthority("bootstrap", "synthetic")
    const namespace = createHash("sha256")
      .update(process.env.SESSION_SEAL_PASSWORD as string)
      .digest("hex")
      .slice(0, 24)
    db = new DatabaseSync(
      join(tmpdir(), "aerpp-coordination", namespace, "server-sessions.sqlite"),
    )
  }
  db.exec("DELETE FROM sessions")
  db.prepare(
    "UPDATE authority_buckets SET tokens = ?, refilled = ? WHERE kind = ?",
  ).run(limits.admissionBurst, now, "admission")
  db.prepare(
    "UPDATE authority_buckets SET tokens = ?, refilled = ? WHERE kind = ?",
  ).run(limits.recoveryBurst, now, "recovery")
})
afterEach(() => vi.useRealTimers())
afterAll(() => db.close())

it.each(
  [false, undefined, null, "false", 1, {}, [], Promise.resolve(true)].map(
    (accepted) => ({ accepted }),
  ),
)(
  "cancels execution unless its authority predicate confirms true ($accepted)",
  ({ accepted }) => {
    createAuthority("watched", "original")
    const accepts = vi.fn(() => true)
    const watcher = watchAuthority("watched", accepts)
    try {
      expect(watcher.signal.aborted).toBe(false)
      accepts.mockReturnValue(accepted as boolean)
      updateAuthority("watched", (record) => ({
        ...record,
        revision: record.revision + 1,
      }))
      expect(watcher.signal.aborted).toBe(true)
    } finally {
      watcher.dispose()
    }
  },
)

it("retains indefinite credentials and revocation fences across years", () => {
  createAuthority("persistent", "original", {
    state: "{}",
    credentialHash: "digest",
  })
  revokeAuthority("revoked", "tombstone")
  vi.advanceTimersByTime(800 * 24 * 3600_000)
  createAuthority("new-session", "synthetic")
  expect(readAuthority("persistent")?.credentialHash).toBe("digest")
  expect(readAuthority("revoked")?.hash).toBe("tombstone")
  expect(createAuthority("revoked", "resurrected")).toBe(false)
})

it("releases only process-owned abandoned locks without changing authentication or the business hash", () => {
  createAuthority("execution", "original", {
    state: "{}",
    credentialHash: "digest",
  })
  const live = createOperationId()
  updateAuthority("execution", (record) => ({ ...record, busy: live }))
  expect(readAuthority("execution")?.busy).toBe(live)
  const dead = live.replace(/\.\d+\.(\d+):/, ".2147483647.$1:")
  updateAuthority("execution", (record) => ({ ...record, busy: dead }))
  expect(readAuthority("execution")).toMatchObject({
    busy: null,
    hash: "original",
    credentialHash: "digest",
    revision: 1,
  })
  updateAuthority("execution", (record) => ({
    ...record,
    busy: "unverifiable-operation",
  }))
  expect(readAuthority("execution")?.busy).toBe("unverifiable-operation")
})

function seed(count: number) {
  db.exec("BEGIN IMMEDIATE")
  const insert = db.prepare(
    "INSERT INTO sessions (id, revision, hash) VALUES (?, 0, 'synthetic')",
  )
  for (let i = 0; i < count; i++) insert.run(`seed-${i}`)
  db.exec("COMMIT")
}

it("bounds varied anonymous IDs, preserves ten participants, and refills admission", () => {
  for (let i = 0; i < limits.admissionBurst; i++)
    expect(createAuthority(`participant-${i}`, "synthetic")).toBe(true)
  expect(() => createAuthority("overflow", "synthetic")).toThrow("limit")
  expect(readAuthority("overflow")).toBeNull()
  for (let i = 0; i < 10; i++) {
    expect(createAuthority(`participant-${i}`, "replacement")).toBe(false)
    expect(
      updateAuthority(`participant-${i}`, (record) => ({
        ...record,
        revision: 1,
      })),
    ).toBe(true)
    revokeAuthority(`participant-${i}`, "revoked")
    expect(readAuthority(`participant-${i}`)?.hash).toBe("revoked")
  }
  vi.advanceTimersByTime(1000)
  expect(createAuthority("retry", "synthetic")).toBe(true)
  expect(() => createAuthority("another", "synthetic")).toThrow("limit")
})

it("reserves recovery capacity and never evicts a live record or tombstone", () => {
  seed(limits.maxRecords - limits.recoveryReserve)
  expect(() => createAuthority("new", "synthetic")).toThrow("capacity")
  revokeAuthority("unknown-reset", "revoked")
  expect(readAuthority("unknown-reset")?.hash).toBe("revoked")
  expect(createAuthority("unknown-reset", "late-save")).toBe(false)
  expect(readAuthority("seed-0")?.hash).toBe("synthetic")
  expect(db.prepare("SELECT records FROM authority_limits").get()).toEqual({
    records: limits.maxRecords - limits.recoveryReserve + 1,
  })
})

it("bounds unknown reset IDs separately but allows existing recovery", () => {
  for (let i = 0; i < limits.recoveryBurst; i++)
    revokeAuthority(`reset-${i}`, "revoked")
  expect(() => revokeAuthority("overflow", "revoked")).toThrow("limit")
  expect(createAuthority("ordinary", "synthetic")).toBe(true)
  revokeAuthority("ordinary", "revoked")
  expect(readAuthority("ordinary")?.hash).toBe("revoked")
})

it("allows existing recovery at total capacity without allocating another record", () => {
  seed(limits.maxRecords)
  expect(() => revokeAuthority("unknown", "revoked")).toThrow("capacity")
  revokeAuthority("seed-0", "revoked")
  expect(readAuthority("seed-0")?.revision).toBe(1)
  expect(db.prepare("SELECT records FROM authority_limits").get()).toEqual({
    records: limits.maxRecords,
  })
})
