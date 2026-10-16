import "server-only"

import { sealData, unsealData } from "iron-session"
import { getSessionOptions } from "@/lib/session"

// Seal transient data with the session password and lifetime; no server persistence.
export async function sealSessionData<T>(data: T): Promise<string | null> {
  try {
    const sealed = await sealData(data, getSessionOptions())
    return sealed
  } catch {
    return null
  }
}

// A seal proves integrity, not payload shape or ownership; callers validate both.
export async function unsealSessionData<T>(
  sealedData: string,
): Promise<T | null> {
  try {
    const data = await unsealData<T>(sealedData, getSessionOptions())
    return data
  } catch {
    return null
  }
}
