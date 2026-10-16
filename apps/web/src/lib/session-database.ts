import "server-only"

import { createHash } from "node:crypto"
import { chmodSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { env } from "@aerpp/config/server/web"

export function openSessionDatabase() {
  const namespace = createHash("sha256")
    .update(env.sessionSealPassword)
    .digest("hex")
    .slice(0, 24)
  const directory = join(tmpdir(), "aerpp-coordination", namespace)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, "server-sessions.sqlite")
  const db = new DatabaseSync(path)
  chmodSync(path, 0o600)
  db.exec(
    "PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON",
  )
  return db
}
