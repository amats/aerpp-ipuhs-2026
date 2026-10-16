import "server-only"

import { env } from "@aerpp/config/server/admin"

const allowedEmailSet = new Set(env.adminAllowedEmails)

export function isAllowedAdminEmail(email: unknown): boolean {
  return typeof email === "string" && allowedEmailSet.has(email.toLowerCase())
}
