"use client"

import { type BrowserState, browserStateSchema } from "./browser-state-types"
import { createTabId } from "./session-generation"

export const BROWSER_DATABASE_NAME = "aerpp-session-coordination"
const listeners = new Set<() => void>()
let cached:
  | Pick<
      BrowserState,
      "scope" | "revision" | "reset" | "contexts" | "recoveryRevision"
    >
  | undefined
let channel: BroadcastChannel | undefined
let observing = false

export function emptyBrowserPayload() {
  return { version: createTabId(), value: null }
}

function createBrowserState(): BrowserState {
  return {
    scope: createTabId(),
    revision: 0,
    reset: null,
    contexts: {},
    analysisResult: emptyBrowserPayload(),
    recoveredSurvey: emptyBrowserPayload(),
  }
}

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* A failed view refresh must not prevent other tabs or views updating. */
    }
  }
}

function cacheState(state: BrowserState) {
  cached = {
    scope: state.scope,
    revision: state.revision,
    reset: state.reset,
    contexts: state.contexts,
    recoveryRevision: state.recoveryRevision,
  }
}

export function readCachedBrowserSession() {
  return cached
}

function observeChanges() {
  if (observing || typeof window === "undefined") return
  observing = true
  const refresh = () => {
    void changeBrowserState(() => ({ value: undefined, changed: false })).then(
      notifyListeners,
      notifyListeners,
    )
  }
  if (typeof window.BroadcastChannel === "function") {
    try {
      channel = new window.BroadcastChannel("aerpp-browser-state")
      channel.onmessage = refresh
    } catch {
      /* Focus refresh and transactional checks remain available. */
    }
  }
  window.addEventListener("focus", refresh)
}

export function subscribeBrowserState(listener: () => void) {
  observeChanges()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Callbacks are synchronous; HTTP, sealing and UI effects stay outside. Only
// IndexedDB is written inside the transaction. Completion, not request success,
// acknowledges the commit, so aborts cannot leave a reported saved retry.
export function changeBrowserState<T>(
  change: (state: BrowserState) => { value: T; changed: boolean },
): Promise<T> {
  observeChanges()
  return new Promise((resolve, reject) => {
    let failed = false
    const opening = indexedDB.open(BROWSER_DATABASE_NAME, 2)
    opening.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) {
        opening.transaction?.abort()
        reject(new Error("Unsupported browser storage; clear site data"))
        return
      }
      opening.result.createObjectStore("coordination")
    }
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => {
      failed = true
      reject(new Error("Browser storage upgrade blocked; reload other tabs"))
    }
    opening.onsuccess = () => {
      const database = opening.result
      if (failed) {
        database.close()
        return
      }
      database.onversionchange = () => database.close()
      try {
        const transaction = database.transaction("coordination", "readwrite", {
          durability: "strict",
        })
        const store = transaction.objectStore("coordination")
        let state: BrowserState
        let result: T
        let failure: unknown
        let changed = false
        const apply = (value: unknown) => {
          try {
            state =
              value === undefined
                ? createBrowserState()
                : browserStateSchema.parse(value)
            const applied = change(state)
            result = applied.value
            changed = applied.changed === true || value === undefined
            if (changed) {
              state.revision += 1
              store.put(browserStateSchema.parse(state), "state")
            }
          } catch (error) {
            failure = error
            transaction.abort()
          }
        }
        const reading = store.get("state")
        reading.onsuccess = () => apply(reading.result)
        transaction.oncomplete = () => {
          database.close()
          cacheState(state)
          if (changed) {
            try {
              channel?.postMessage(null)
            } catch {
              /* Notifications do not undo a commit. */
            }
            notifyListeners()
          }
          resolve(result)
        }
        transaction.onabort = () => {
          database.close()
          reject(
            failure ??
              transaction.error ??
              new Error("Browser transaction aborted"),
          )
        }
      } catch (error) {
        database.close()
        reject(error)
      }
    }
  })
}
