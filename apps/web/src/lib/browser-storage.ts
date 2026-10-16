"use client"

import { z } from "zod"

export const BrowserStorageKey = {
  dismissedInformationMessageIds: "aerpp:dismissed-information-message-ids",
} as const

const dismissedInformationMessageIdsStorageSchema = z
  .array(z.unknown())
  .transform((values) =>
    values.filter((value): value is string => typeof value === "string"),
  )

// Explicit reset clears the entire origin's localStorage, including non-AERPP keys.
export function clearOriginLocalStorage(): void {
  window.localStorage.clear()
}

// Debug-only origin purge after session revocation and reset completion.
// Running pages/workers can lose new data, recreate stores or block deletion;
// the individual cleanup operations cannot form one atomic transaction.
export async function clearOriginBrowserDatabases() {
  if ("serviceWorker" in navigator) {
    for (const registration of await navigator.serviceWorker.getRegistrations())
      await registration.unregister()
  }
  const databases = await indexedDB.databases()
  for (const { name } of databases) {
    if (name === undefined) continue
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(new Error("Browser storage cleanup failed"))
      request.onblocked = () =>
        reject(new Error("Browser storage cleanup blocked"))
    })
  }
  if ("caches" in window) {
    for (const name of await caches.keys()) await caches.delete(name)
  }
  if (typeof navigator.storage?.getDirectory === "function") {
    const directory = await navigator.storage.getDirectory()
    for await (const name of directory.keys())
      await directory.removeEntry(name, { recursive: true })
  }
}

// Reads dismissed information message IDs while ignoring malformed entries.
export function readDismissedInformationMessageIdsFromLocalStorage(): string[] {
  try {
    const storedValue = window.localStorage.getItem(
      BrowserStorageKey.dismissedInformationMessageIds,
    )
    if (!storedValue) {
      return []
    }
    const parsedValue = JSON.parse(storedValue) as unknown
    const parsedMessages =
      dismissedInformationMessageIdsStorageSchema.safeParse(parsedValue)
    return parsedMessages.success ? parsedMessages.data : []
  } catch {
    return []
  }
}

// Persists the complete set of dismissed information message IDs.
export function saveDismissedInformationMessageIdsToLocalStorage(
  messageIds: string[],
): void {
  window.localStorage.setItem(
    BrowserStorageKey.dismissedInformationMessageIds,
    JSON.stringify(messageIds),
  )
}
