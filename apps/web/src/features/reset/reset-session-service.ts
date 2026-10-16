import "server-only"

import { cookies } from "next/headers"
import { revokeSession } from "@/lib/session"
import { readAuthority } from "@/lib/session-authority"
import {
  isSessionGeneration,
  SESSION_COOKIE_PREFIX,
} from "@/lib/session-generation"

export async function resetSession(scope: string, replacementScope?: string) {
  if (
    !isSessionGeneration(scope) ||
    (replacementScope !== undefined &&
      (!isSessionGeneration(replacementScope) ||
        replacementScope === scope ||
        readAuthority(replacementScope)))
  )
    throw new Error("Invalid reset generation")
  // Invalidate late writes before the browser clears its local data.
  await revokeSession(scope)
  const cookieStore = await cookies()
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith(SESSION_COOKIE_PREFIX)) {
      const id = cookie.name.slice(SESSION_COOKIE_PREFIX.length).split(".")[0]
      if (isSessionGeneration(id) && id !== scope) await revokeSession(id)
    }
    cookieStore.delete(cookie.name)
  }
}
