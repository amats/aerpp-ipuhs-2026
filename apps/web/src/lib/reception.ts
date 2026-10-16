import "server-only"

import { env } from "@aerpp/config/server/web"

export function isReceptionClosed() {
  return Date.now() >= env.receptionExpiresAt.getTime()
}

export function assertReceptionOpen() {
  if (isReceptionClosed()) throw new Error("Support reception has ended")
}
