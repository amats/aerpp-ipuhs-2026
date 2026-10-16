import "server-only"

import { headers } from "next/headers"
import { createLogger, getRequestContextFromHeaders } from "@/lib/logger"

export async function createStepStateLogger(operation: string) {
  try {
    const headerStore = await headers()
    return createLogger({
      ...getRequestContextFromHeaders(headerStore),
      component: "step_state",
      operation,
    })
  } catch {
    return createLogger({
      component: "step_state",
      operation,
    })
  }
}
