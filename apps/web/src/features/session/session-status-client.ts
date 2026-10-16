"use client"

import { sessionStatusSchema } from "./session-status-types"

export async function fetchSessionStatus(token: string) {
  const response = await fetch("/api/session-status", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { "x-aerpp-tab": token },
  })
  if (!response.ok) return null
  const parsed = sessionStatusSchema.safeParse(await response.json())
  return parsed.success ? parsed.data : null
}
