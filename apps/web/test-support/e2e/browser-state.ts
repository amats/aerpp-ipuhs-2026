import type { Page } from "@playwright/test"
import type { BrowserState } from "../../src/lib/browser-state-types"

export async function readBrowserState(page: Page) {
  return page.evaluate(
    () =>
      new Promise<BrowserState>((resolve, reject) => {
        const opening = indexedDB.open("aerpp-session-coordination", 2)
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result
          const tx = db.transaction("coordination", "readonly")
          const request = tx.objectStore("coordination").get("state")
          tx.oncomplete = () => {
            db.close()
            resolve(request.result)
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      }),
  )
}
export async function readStoredResult(page: Page) {
  return (await readBrowserState(page)).analysisResult.value
}
export async function readRecoveredDraft(page: Page) {
  return (await readBrowserState(page)).recoveredSurvey.value
}
export async function readBrowserScope(page: Page) {
  return (await readBrowserState(page)).scope
}
export async function readBrowserContext(page: Page) {
  const state = await readBrowserState(page)
  return state.contexts[state.scope]
    ? JSON.stringify(state.contexts[state.scope])
    : null
}
export async function writeStoredResult(page: Page, value: string | null) {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("aerpp-session-coordination", 2)
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result
          const tx = db.transaction("coordination", "readwrite")
          const store = tx.objectStore("coordination")
          const request = store.get("state")
          request.onsuccess = () => {
            const state: BrowserState = request.result
            state.analysisResult = { version: crypto.randomUUID(), value }
            state.revision += 1
            store.put(state, "state")
          }
          tx.oncomplete = () => {
            db.close()
            const channel = new BroadcastChannel("aerpp-browser-state")
            channel.postMessage(null)
            channel.close()
            resolve()
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      }),
    value,
  )
}
