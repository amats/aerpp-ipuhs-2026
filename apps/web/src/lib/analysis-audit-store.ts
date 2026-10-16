import "server-only"

import { createHash, randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"
import { RecordAnalysisOutcomeRequestSchema } from "@aerpp/participant-api-contracts/participant-api"
import type { z } from "zod"
import { retryAfterMs } from "./http-retry"
import { openSessionDatabase } from "./session-database"

export type AnalysisAuditOutcome = z.infer<
  typeof RecordAnalysisOutcomeRequestSchema
>
type Lease = {
  id: string
  token: string
  body: AnalysisAuditOutcome
  attempts: number
}

function identity(body: AnalysisAuditOutcome) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        body.serverId,
        body.clientId,
        body.pseudonym,
        body.consentId,
        body.analysisId,
      ]),
    )
    .digest("hex")
}

function payload(input: AnalysisAuditOutcome) {
  const body = RecordAnalysisOutcomeRequestSchema.parse(input)
  return { body, json: JSON.stringify(body), id: identity(body) }
}

// Only the strict operational schema reaches disk. Research measurements are
// deliberately absent, including duration and document counts.
export function createAnalysisAuditStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS analysis_audit_outbox (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL, queuedAt INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL,
    leaseToken TEXT, leasedUntil INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', lastCode INTEGER
  ); CREATE INDEX IF NOT EXISTS analysis_audit_due ON analysis_audit_outbox(status, nextAttemptAt);`)
  function transaction<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE")
    try {
      const result = fn()
      db.exec("COMMIT")
      return result
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
  return {
    assertWritable() {
      transaction(() => {
        const count = db
          .prepare("SELECT COUNT(*) AS count FROM analysis_audit_outbox")
          .get()
        if (Number(count?.count) >= 10_000) throw new Error("AUDIT_OUTBOX_FULL")
        db.prepare(
          "UPDATE analysis_audit_outbox SET attempts = attempts WHERE 0",
        ).run()
      })
    },
    enqueue(
      input: AnalysisAuditOutcome,
      now = Date.now(),
      checkpoint?: (connection: DatabaseSync) => void,
    ) {
      const value = payload(input)
      transaction(() => {
        const old = db
          .prepare("SELECT payload FROM analysis_audit_outbox WHERE id = ?")
          .get(value.id)
        if (old) {
          if (old.payload !== value.json)
            throw new Error("AUDIT_OUTCOME_CONFLICT")
        } else {
          const count = db
            .prepare("SELECT COUNT(*) AS count FROM analysis_audit_outbox")
            .get()
          if (Number(count?.count) >= 10_000)
            throw new Error("AUDIT_OUTBOX_FULL")
          db.prepare(
            "INSERT INTO analysis_audit_outbox (id, payload, queuedAt, nextAttemptAt) VALUES (?, ?, ?, ?)",
          ).run(value.id, value.json, now, now + 30_000)
        }
        // Both facts use this connection and commit together. No network work.
        checkpoint?.(db)
      })
    },
    acknowledge(input: AnalysisAuditOutcome) {
      const value = payload(input)
      db.prepare(
        "DELETE FROM analysis_audit_outbox WHERE id = ? AND payload = ?",
      ).run(value.id, value.json)
    },
    claim(now = Date.now()): Lease | null {
      return transaction(() => {
        const row = db
          .prepare(
            "SELECT id, payload, attempts FROM analysis_audit_outbox WHERE status = 'pending' AND nextAttemptAt <= ? AND leasedUntil <= ? ORDER BY nextAttemptAt, queuedAt LIMIT 1",
          )
          .get(now, now)
        if (!row) return null
        const body = RecordAnalysisOutcomeRequestSchema.safeParse(
          (() => {
            try {
              return JSON.parse(String(row.payload))
            } catch {
              return null
            }
          })(),
        )
        if (body.success !== true) {
          db.prepare(
            "UPDATE analysis_audit_outbox SET status = 'blocked', lastCode = 400 WHERE id = ?",
          ).run(String(row.id))
          return null
        }
        const token = randomUUID()
        db.prepare(
          "UPDATE analysis_audit_outbox SET leaseToken = ?, leasedUntil = ?, attempts = attempts + 1 WHERE id = ?",
        ).run(token, now + 60_000, String(row.id))
        return {
          id: String(row.id),
          token,
          body: body.data,
          attempts: Number(row.attempts) + 1,
        }
      })
    },
    settle(
      lease: Lease,
      success: boolean,
      code: number | null,
      now = Date.now(),
      retryAfter: string | null = null,
    ) {
      if (success === true) {
        db.prepare(
          "DELETE FROM analysis_audit_outbox WHERE id = ? AND leaseToken = ?",
        ).run(lease.id, lease.token)
        return
      }
      const blocked = code === 400 || code === 409
      const backoff = Math.min(
        300_000,
        5_000 * 2 ** Math.min(lease.attempts - 1, 6),
      )
      // Stable per-notice jitter spreads workers without changing retry identity.
      const jitter =
        createHash("sha256")
          .update(`${lease.id}:${lease.attempts}`)
          .digest()
          .readUInt16BE(0) % Math.max(1, Math.floor(backoff / 5))
      const delay = Math.max(
        backoff + jitter,
        retryAfterMs(retryAfter, now),
        code === 401 || code === 403 ? 300_000 : 0,
      )
      db.prepare(
        "UPDATE analysis_audit_outbox SET status = ?, lastCode = ?, nextAttemptAt = ?, leaseToken = NULL, leasedUntil = 0 WHERE id = ? AND leaseToken = ?",
      ).run(
        blocked === true ? "blocked" : "pending",
        code,
        now + delay,
        lease.id,
        lease.token,
      )
    },
    counts() {
      return db
        .prepare(
          "SELECT status, COUNT(*) AS count FROM analysis_audit_outbox GROUP BY status",
        )
        .all()
    },
    health(now = Date.now()) {
      const row = db
        .prepare(`SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        MIN(queuedAt) AS oldest FROM analysis_audit_outbox`)
        .get()
      return {
        pendingCount: Number(row?.pending ?? 0),
        blockedCount: Number(row?.blocked ?? 0),
        oldestAgeMs:
          row?.oldest == null ? 0 : Math.max(0, now - Number(row.oldest)),
      }
    },
  }
}

let store: ReturnType<typeof createAnalysisAuditStore> | undefined
export function analysisAuditStore() {
  store ??= createAnalysisAuditStore(openSessionDatabase())
  return store
}
