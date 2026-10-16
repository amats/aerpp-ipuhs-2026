"use client"

import { readCachedBrowserSession } from "./browser-database"

let tabToken: string | undefined
export function getTabToken() {
  if (!tabToken) return undefined
  const scope = tabToken.split(":")[0]
  try {
    const context = readStoredSessionContext(scope)?.value
    return context ? `${tabToken}:${context}` : tabToken
  } catch {
    return tabToken
  }
}
export function readStoredSessionContext(scope: string) {
  return readCachedBrowserSession()?.contexts[scope] ?? null
}
export function setTabToken(token: string) {
  // Keep the stamp of this tab's displayed state, independently of shared context.
  tabToken = token.split(":").slice(0, 2).join(":")
}
