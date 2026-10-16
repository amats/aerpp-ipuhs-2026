import "server-only"

import { env } from "@aerpp/config/server/web"
import { assertReceptionOpen } from "./reception"

export function participantApiHeaders(): Record<string, string> {
  assertReceptionOpen()
  return participantAuditHeaders()
}

// Historical audit delivery remains allowed after reception closes.
export function participantAuditHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env.supportApiCredential}` }
}
