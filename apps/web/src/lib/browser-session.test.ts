/** @vitest-environment jsdom */
import { IDBObjectStore } from "fake-indexeddb"
import { beforeEach, expect, it, vi } from "vitest"
import {
  changeBrowserState,
  readCachedBrowserSession,
  subscribeBrowserState,
} from "./browser-database"
import {
  beginBrowserReset,
  cancelBrowserReset,
  captureBrowserAnalysis,
  clearBrowserAnalysis,
  clearBrowserForAdminRecovery,
  commitBrowserAdmission,
  commitSessionBrowserContext,
  finishBrowserReset,
  getBrowserSession,
  readBrowserAnalysisPresence,
  readBrowserPayload,
  replaceBrowserPayload,
} from "./browser-session"

const legacyScope = "11111111-1111-1111-1111-111111111111"
beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})
const put = async (
  key: "analysisResult" | "recoveredSurvey",
  value: string,
) => {
  expect(
    await replaceBrowserPayload(key, await readBrowserPayload(key), value),
  ).toBe(true)
}
it("discards changing old payloads only for an accepted recovery revision and fences late writes", async () => {
  const scope = await getBrowserSession()
  await commitSessionBrowserContext(scope, 10, "old-private-context")
  await put("analysisResult", "old-result")
  const lateWrite = await readBrowserPayload("analysisResult")
  await put("recoveredSurvey", "old-frozen-answers")
  expect(await clearBrowserForAdminRecovery(scope, 11)).toBe(true)
  expect(await readBrowserAnalysisPresence()).toEqual({
    analysisResult: false,
    recoveredSurvey: false,
  })
  expect(
    await replaceBrowserPayload("analysisResult", lateWrite, "late-result"),
  ).toBe(false)
  expect(
    await commitSessionBrowserContext(scope, 10, "late-private-context"),
  ).toBe(false)
  await put("analysisResult", "new-result")
  expect(await clearBrowserForAdminRecovery(scope, 11)).toBe(true)
  expect((await readBrowserPayload("analysisResult")).value).toBe("new-result")
  await commitSessionBrowserContext(scope, 12, "new-private-context")
  expect(await clearBrowserForAdminRecovery(scope, 11)).toBe(false)
  expect((await readBrowserPayload("analysisResult")).value).toBe("new-result")
})

it("retries recovery cleanup after its IndexedDB transaction aborts", async () => {
  const scope = await getBrowserSession()
  await put("analysisResult", "retained")
  abortNextCommit()
  await expect(clearBrowserForAdminRecovery(scope, 20)).rejects.toBeDefined()
  expect((await readBrowserPayload("analysisResult")).value).toBe("retained")
  expect(await clearBrowserForAdminRecovery(scope, 20)).toBe(true)
  expect((await readBrowserPayload("analysisResult")).value).toBeNull()
})
it("reads both cleanup targets together without returning their contents or changing their versions", async () => {
  await getBrowserSession()
  expect(await readBrowserAnalysisPresence()).toEqual({
    analysisResult: false,
    recoveredSurvey: false,
  })
  await put("recoveredSurvey", "sealed-draft")
  const captured = await captureBrowserAnalysis()
  expect(await readBrowserAnalysisPresence()).toEqual({
    analysisResult: false,
    recoveredSurvey: true,
  })
  expect(await captureBrowserAnalysis()).toEqual(captured)
  await put("analysisResult", "sealed-result")
  expect(await readBrowserAnalysisPresence()).toEqual({
    analysisResult: true,
    recoveredSurvey: true,
  })
  await beginBrowserReset()
  await expect(readBrowserAnalysisPresence()).rejects.toThrow(
    "Browser session changed",
  )
})
function abortNextCommit() {
  const original = IDBObjectStore.prototype.put
  return vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementationOnce(function (this: IDBObjectStore, ...args) {
      const request = original.apply(this, args)
      request.addEventListener("success", () => this.transaction.abort())
      return request
    })
}
it("starts empty without importing retired localStorage participant state", async () => {
  localStorage.setItem("aerpp-tab-scope", legacyScope)
  localStorage.setItem(
    `aerpp:session-context:${legacyScope}`,
    JSON.stringify({ revision: 3, value: "sealed-context" }),
  )
  localStorage.setItem("aerpp:analysis-result", "sealed-result")
  localStorage.setItem("aerpp:recovered-survey", "sealed-survey")
  const scope = await getBrowserSession()
  expect(scope).not.toBe(legacyScope)
  expect((await readBrowserPayload("analysisResult")).value).toBeNull()
  expect((await readBrowserPayload("recoveredSurvey")).value).toBeNull()
  expect(readCachedBrowserSession()?.contexts).toEqual({})
  expect(await getBrowserSession()).toBe(scope)
})
it("retries an aborted initial state creation without acknowledging a session", async () => {
  abortNextCommit()
  await expect(getBrowserSession()).rejects.toBeDefined()
  const scope = await getBrowserSession()
  expect(await getBrowserSession()).toBe(scope)
  expect((await readBrowserPayload("analysisResult")).value).toBeNull()
})
it("participant cleanup does not depend on localStorage access", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable")
  })
  const remove = vi
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
  await getBrowserSession()
  await put("analysisResult", "result")
  await put("recoveredSurvey", "retry")
  expect(await clearBrowserAnalysis(await captureBrowserAnalysis())).toBe(true)
  expect((await readBrowserPayload("analysisResult")).value).toBeNull()
  expect((await readBrowserPayload("recoveredSurvey")).value).toBeNull()
  expect(get).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
})
it("acknowledges repeated cleanup only while both payloads remain empty in the same generation", async () => {
  await getBrowserSession()
  await put("analysisResult", "original")
  const snapshot = await captureBrowserAnalysis()
  expect(await clearBrowserAnalysis(snapshot)).toBe(true)
  expect(await clearBrowserAnalysis(snapshot)).toBe(true)
  await put("recoveredSurvey", "new")
  expect(await clearBrowserAnalysis(snapshot)).toBe(false)
  const reset = await beginBrowserReset()
  await finishBrowserReset(reset)
  expect(await clearBrowserAnalysis(snapshot)).toBe(false)
})
it("a request success followed by transaction abort neither persists nor acknowledges a context", async () => {
  const scope = await getBrowserSession()
  await commitSessionBrowserContext(scope, 1, "original")
  const notified = vi.fn()
  const unsubscribe = subscribeBrowserState(notified)
  abortNextCommit()
  await expect(
    commitSessionBrowserContext(scope, 2, "uncommitted"),
  ).rejects.toBeDefined()
  unsubscribe()
  expect(notified).not.toHaveBeenCalled()
  expect(readCachedBrowserSession()?.contexts[scope]).toEqual({
    revision: 1,
    value: "original",
  })
  await getBrowserSession()
  expect(readCachedBrowserSession()?.contexts[scope].value).toBe("original")
})
it("rejects older context responses even after removing context", async () => {
  const scope = await getBrowserSession()
  expect(await commitSessionBrowserContext(scope, 4, null)).toBe(true)
  expect(await commitSessionBrowserContext(scope, 3, "late")).toBe(false)
  expect(readCachedBrowserSession()?.contexts[scope].value).toBeNull()
})
it("concurrent writers compare and replace one version atomically", async () => {
  await getBrowserSession()
  const snapshot = await readBrowserPayload("analysisResult")
  const outcomes = await Promise.all([
    replaceBrowserPayload("analysisResult", snapshot, "A"),
    replaceBrowserPayload("analysisResult", snapshot, "B"),
  ])
  expect(outcomes.filter((ok) => ok === true)).toHaveLength(1)
})
it("rejects an ABA write even when the bytes return to their old value", async () => {
  await getBrowserSession()
  await put("analysisResult", "original")
  const snapshot = await readBrowserPayload("analysisResult")
  await put("analysisResult", "other")
  await put("analysisResult", "original")
  expect(await replaceBrowserPayload("analysisResult", snapshot, "late")).toBe(
    false,
  )
})
it("reset fences both payload writes and context adoption across the network wait", async () => {
  const scope = await getBrowserSession()
  const old = await readBrowserPayload("analysisResult")
  const reset = await beginBrowserReset()
  expect(await replaceBrowserPayload("analysisResult", old, "late")).toBe(false)
  expect(await commitSessionBrowserContext(scope, 9, "late")).toBe(false)
  const replacement = await beginBrowserReset()
  expect(await finishBrowserReset(reset)).toBe(false)
  expect(await finishBrowserReset(replacement)).toBe(true)
  expect(await replaceBrowserPayload("analysisResult", old, "later")).toBe(
    false,
  )
  expect(await getBrowserSession()).toBe(replacement.replacementScope)
})
it("reset atomically replaces scope and clears all participant payloads, rolling back on abort", async () => {
  const scope = await getBrowserSession()
  await commitSessionBrowserContext(scope, 1, "context")
  await put("analysisResult", "result")
  await put("recoveredSurvey", "survey")
  const reset = await beginBrowserReset()
  abortNextCommit()
  await expect(finishBrowserReset(reset)).rejects.toBeDefined()
  const retained = await changeBrowserState((state) => ({
    value: state,
    changed: false,
  }))
  expect(retained.scope).toBe(scope)
  expect(retained.analysisResult.value).toBe("result")
  expect(retained.recoveredSurvey.value).toBe("survey")
  expect(retained.contexts[scope].value).toBe("context")
  expect(retained.reset?.attempt).toBe(reset.attempt)
  expect(await finishBrowserReset(reset)).toBe(true)
  expect((await readBrowserPayload("analysisResult")).value).toBeNull()
  expect((await readBrowserPayload("recoveredSurvey")).value).toBeNull()
  expect(readCachedBrowserSession()?.contexts).toEqual({})
})
it("cancelled reset retains data, and late cleanup cannot remove a replacement", async () => {
  await getBrowserSession()
  await put("analysisResult", "old")
  await put("recoveredSurvey", "draft")
  const before = await captureBrowserAnalysis()
  const reset = await beginBrowserReset()
  await cancelBrowserReset(reset)
  await put("analysisResult", "new")
  expect(await clearBrowserAnalysis(before)).toBe(false)
  expect((await readBrowserPayload("recoveredSurvey")).value).toBe("draft")
  expect(await clearBrowserAnalysis(await captureBrowserAnalysis())).toBe(true)
  expect((await readBrowserPayload("recoveredSurvey")).value).toBeNull()
})
it("confirmed invalid admission replaces data atomically and never reimports old keys", async () => {
  const scope = await getBrowserSession()
  await put("analysisResult", "old")
  const next = "22222222-2222-2222-2222-222222222222"
  await commitBrowserAdmission(scope, next, true)
  localStorage.setItem("aerpp:analysis-result", "late-old-client")
  expect(await getBrowserSession()).toBe(next)
  expect((await readBrowserPayload("analysisResult")).value).toBeNull()
})

it("rejects unsupported database versions without importing or discarding a pending reset", async () => {
  const oldReset = {
    scope: legacyScope,
    previousScope: legacyScope,
    attempt: legacyScope,
    replacementScope: "22222222-2222-2222-2222-222222222222",
  }
  await new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("aerpp-session-coordination", 1)
    opening.onupgradeneeded = () =>
      opening.result.createObjectStore("coordination")
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const database = opening.result
      const transaction = database.transaction("coordination", "readwrite")
      transaction.objectStore("coordination").put(oldReset, "reset")
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onabort = () => reject(transaction.error)
    }
  })
  await expect(getBrowserSession()).rejects.toThrow(
    "Unsupported browser storage",
  )
  const retained = await new Promise<unknown>((resolve, reject) => {
    const opening = indexedDB.open("aerpp-session-coordination", 1)
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const database = opening.result
      const transaction = database.transaction("coordination", "readonly")
      const reading = transaction.objectStore("coordination").get("reset")
      transaction.oncomplete = () => {
        database.close()
        resolve(reading.result)
      }
      transaction.onabort = () => reject(transaction.error)
    }
  })
  expect(retained).toEqual(oldReset)
})
