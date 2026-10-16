import "server-only"

import { unstable_rethrow } from "next/navigation"
import { logPageDataFailure } from "./logger"

export async function loadPageData<T>(
  operation: Parameters<typeof logPageDataFailure>[0],
  load: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await load() }
  } catch (error) {
    // Authentication redirects and framework interrupts must reach Next.js.
    unstable_rethrow(error)
    logPageDataFailure(operation, error)
    return { ok: false }
  }
}
