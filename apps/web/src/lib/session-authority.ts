import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import { SESSION_AUTHORITY_CONSTRAINTS as limits } from "./session-authority-constraints"
import { openSessionDatabase } from "./session-database"

// Only allowlisted session metadata and credential digests live here.
// All workers for this Web instance must share this file.
export type AuthorityRecord = {
  id: string
  revision: number
  hash: string
  busy: string | null
  withdrawing: number
  updated: number
  state: string | null
  credentialHash: string | null
}

let database: DatabaseSync | undefined
const authorityWatchers = new Map<string, Set<() => void>>()

function processIdentity(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]
  return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}.${pid}.${start}`
}

export function createOperationId() {
  // On Linux, retained ownership can distinguish PID reuse and host reboot.
  // Other hosts retain ambiguous locks for explicit administrator recovery.
  try {
    return `${processIdentity(process.pid)}:${randomUUID()}`
  } catch {
    return randomUUID()
  }
}

function abandonedOperation(operation: string) {
  const match = /^([a-f0-9-]+)\.(\d+)\.(\d+):/.exec(operation)
  if (!match) return false
  try {
    return processIdentity(Number(match[2])) !== operation.split(":")[0]
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
  }
}

// Local commits notify immediately; other workers share the SQLite authority.
export function watchAuthority(
  id: string,
  accepts: (current: AuthorityRecord) => boolean,
) {
  const controller = new AbortController()
  const check = () => {
    try {
      const current = readAuthority(id)
      if (current && accepts(current) === true) return
    } catch {
      // Unavailable authority cannot keep an old operation alive.
    }
    controller.abort()
  }
  const watchers = authorityWatchers.get(id) ?? new Set<() => void>()
  watchers.add(check)
  authorityWatchers.set(id, watchers)
  const interval = setInterval(check, 250)
  interval.unref()
  const dispose = () => {
    clearInterval(interval)
    watchers.delete(check)
    if (watchers.size === 0) authorityWatchers.delete(id)
  }
  controller.signal.addEventListener("abort", dispose, { once: true })
  check()
  return { signal: controller.signal, dispose }
}

function getDatabase() {
  if (database) return database
  const db = openSessionDatabase()
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, revision INTEGER NOT NULL, hash TEXT NOT NULL,
    busy TEXT, withdrawing INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    state TEXT, credentialHash TEXT
  )`)
    db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_operations (
      sessionId TEXT PRIMARY KEY, attemptHash TEXT NOT NULL,
      outcome TEXT NOT NULL, expires INTEGER NOT NULL, executionOwner TEXT
    );
    CREATE TABLE IF NOT EXISTS authority_limits (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      records INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS authority_buckets (
      kind TEXT PRIMARY KEY CHECK (kind IN ('admission', 'recovery')),
      tokens REAL NOT NULL, refilled INTEGER NOT NULL
    );
  `)
    // Initialize accounting once; subsequent inserts/deletes maintain the
    // count atomically, avoiding a full-table COUNT on every anonymous request.
    db.exec(
      `INSERT OR IGNORE INTO authority_limits VALUES (1, (SELECT COUNT(*) FROM sessions))`,
    )
    db.exec(`
    CREATE TRIGGER IF NOT EXISTS authority_insert AFTER INSERT ON sessions
    BEGIN UPDATE authority_limits SET records = records + 1 WHERE id = 1; END;
    CREATE TRIGGER IF NOT EXISTS authority_delete AFTER DELETE ON sessions
    BEGIN UPDATE authority_limits SET records = records - 1 WHERE id = 1; END;
  `)
    const bucket = db.prepare(
      "INSERT OR IGNORE INTO authority_buckets VALUES (?, ?, ?)",
    )
    bucket.run("admission", limits.admissionBurst, Date.now())
    bucket.run("recovery", limits.recoveryBurst, Date.now())
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    db.close()
    throw error
  }
  database = db
  return db
}

export function readAuthority(id: string): AuthorityRecord | null {
  const row = getDatabase()
    .prepare(
      "SELECT id, revision, hash, busy, withdrawing, updated, state, credentialHash FROM sessions WHERE id = ?",
    )
    .get(id)
  if (!row) return null
  const record = row as unknown as AuthorityRecord
  if (record.busy && abandonedOperation(record.busy) === true) {
    // Do not change the business stamp or claim an unknown external outcome.
    getDatabase()
      .prepare("UPDATE sessions SET busy = NULL WHERE id = ? AND busy = ?")
      .run(id, record.busy)
    record.busy = null
  }
  return record
}

export function createAuthority(
  id: string,
  hash: string,
  data?: Pick<AuthorityRecord, "state" | "credentialHash">,
) {
  const db = getDatabase()
  let rejection: string | null = null
  db.exec("BEGIN IMMEDIATE")
  try {
    if (db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
      db.exec("COMMIT")
      return false
    }
    rejection = reserveAuthority(db, "admission")
    if (rejection === null)
      db.prepare(
        "INSERT INTO sessions (id, revision, hash, updated, state, credentialHash) VALUES (?, 1, ?, ?, ?, ?)",
      ).run(
        id,
        hash,
        Date.now(),
        data?.state ?? null,
        data?.credentialHash ?? null,
      )
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  if (rejection !== null) throw new Error(rejection)
  return true
}

function reserveAuthority(db: DatabaseSync, kind: "admission" | "recovery") {
  const now = Date.now()
  const state = db
    .prepare("SELECT records FROM authority_limits WHERE id = 1")
    .get() as { records: number }
  const maximum =
    limits.maxRecords - (kind === "admission" ? limits.recoveryReserve : 0)
  if (state.records >= maximum) return "Session capacity reached; retry later"
  const bucket = db
    .prepare("SELECT tokens, refilled FROM authority_buckets WHERE kind = ?")
    .get(kind) as { tokens: number; refilled: number }
  const burst =
    kind === "admission" ? limits.admissionBurst : limits.recoveryBurst
  const perMinute =
    kind === "admission" ? limits.admissionPerMinute : limits.recoveryPerMinute
  const tokens = Math.min(
    burst,
    bucket.tokens + (Math.max(0, now - bucket.refilled) * perMinute) / 60000,
  )
  if (tokens < 1) return "Session creation limit reached; retry later"
  db.prepare(
    "UPDATE authority_buckets SET tokens = ?, refilled = ? WHERE kind = ?",
  ).run(tokens - 1, Math.max(now, bucket.refilled), kind)
  return null
}

export function revokeAuthority(id: string, hash: string) {
  const db = getDatabase()
  let rejection: string | null = null
  db.exec("BEGIN IMMEDIATE")
  try {
    // Existing generations must remain revocable when admission is exhausted.
    const current = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)
    if (current) {
      db.prepare(`UPDATE sessions SET hash = ?, revision = revision + 1,
        busy = NULL, withdrawing = 0, updated = 0,
        state = NULL, credentialHash = NULL WHERE id = ?`).run(hash, id)
    } else {
      rejection = reserveAuthority(db, "recovery")
      if (rejection === null)
        db.prepare(
          "INSERT INTO sessions (id, revision, hash, updated) VALUES (?, 1, ?, 0)",
        ).run(id, hash)
    }
    db.prepare("DELETE FROM analysis_operations WHERE sessionId = ?").run(id)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  if (rejection !== null) throw new Error(rejection)
  for (const check of authorityWatchers.get(id) ?? []) check()
}

export function updateAuthority(
  id: string,
  update: (current: AuthorityRecord) => AuthorityRecord | null,
) {
  const db = getDatabase()
  db.exec("BEGIN IMMEDIATE")
  try {
    const current = readAuthority(id)
    const next = current && update(current)
    if (!current || !next) {
      db.exec("ROLLBACK")
      return false
    }
    db.prepare(
      `UPDATE sessions SET revision=?, hash=?, busy=?, withdrawing=?, updated=?, state=?, credentialHash=? WHERE id=?`,
    ).run(
      next.revision,
      next.hash,
      next.busy,
      next.withdrawing,
      next.hash === current.hash ? current.updated : Date.now(),
      next.state,
      next.credentialHash,
      id,
    )
    db.exec("COMMIT")
    for (const check of authorityWatchers.get(id) ?? []) check()
    return true
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export const sessionOperation = new AsyncLocalStorage<{
  id: string
  operationId: string
  readOnly?: true
  signal?: AbortSignal
  browserContext?: string | null
  browserContextChanged?: boolean
}>()

// Transient execution metadata; never a session snapshot, document or result.
export function setAnalysisOperation(
  id: string,
  analysisId: string,
  outcome: string,
  connection?: DatabaseSync,
) {
  const hash = createHash("sha256").update(`${id}\0${analysisId}`).digest("hex")
  const db = connection ?? getDatabase()
  db.prepare(
    "DELETE FROM analysis_operations WHERE expires <= ? AND sessionId <> ?",
  ).run(Date.now(), id)
  const expires =
    Date.now() + (outcome === "running" ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000)
  if (outcome === "running") {
    db.prepare(
      "INSERT INTO analysis_operations (sessionId, attemptHash, outcome, expires, executionOwner) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sessionId) DO UPDATE SET attemptHash=excluded.attemptHash, outcome=excluded.outcome, expires=excluded.expires, executionOwner=excluded.executionOwner",
    ).run(id, hash, outcome, expires, createOperationId())
  } else {
    // A historical completion cannot replace a newer attempt or recreate reset metadata.
    db.prepare(
      "UPDATE analysis_operations SET outcome=?, expires=? WHERE sessionId=? AND attemptHash=?",
    ).run(outcome, expires, id, hash)
  }
}

export function readAnalysisOperation(
  id: string,
  analysisId: string,
): string | null {
  const hash = createHash("sha256").update(`${id}\0${analysisId}`).digest("hex")
  const row = getDatabase()
    .prepare(
      "SELECT outcome FROM analysis_operations WHERE sessionId=? AND attemptHash=? AND expires > ?",
    )
    .get(id, hash, Date.now())
  return row ? String(row.outcome) : null
}

export function isAnalysisExecutionAbandoned(id: string, analysisId: string) {
  const hash = createHash("sha256").update(`${id}\0${analysisId}`).digest("hex")
  const record = getDatabase()
    .prepare(
      "SELECT executionOwner FROM analysis_operations WHERE sessionId = ? AND attemptHash = ?",
    )
    .get(id, hash)
  return (
    typeof record?.executionOwner === "string" &&
    abandonedOperation(record.executionOwner) === true
  )
}
