import "server-only"

import { createHash } from "node:crypto"
import { normalizeSessionView, sessionStateSchema } from "./session-data"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined && typeof item !== "function")
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}

// Hash only server-owned business state. Retry secrets and per-tab views are
// excluded; the digest is a consistency stamp, never authentication proof.
export function hashSessionState(state: Record<string, unknown>) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical(
          sessionStateSchema.strip().parse(normalizeSessionView(state)),
        ),
      ),
    )
    .digest("hex")
}
