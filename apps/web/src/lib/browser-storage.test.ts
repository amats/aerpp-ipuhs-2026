/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BROWSER_DATABASE_NAME } from "./browser-database"
import {
  BrowserStorageKey,
  clearOriginBrowserDatabases,
  readDismissedInformationMessageIdsFromLocalStorage,
  saveDismissedInformationMessageIdsToLocalStorage,
} from "./browser-storage"

describe("storage helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("reads dismissed information message ids", () => {
    saveDismissedInformationMessageIdsToLocalStorage(["info-1", "info-2"])

    expect(readDismissedInformationMessageIdsFromLocalStorage()).toEqual([
      "info-1",
      "info-2",
    ])
  })

  it("filters non-string dismissed information message ids", () => {
    window.localStorage.setItem(
      BrowserStorageKey.dismissedInformationMessageIds,
      JSON.stringify(["info-1", 2, null, "info-2"]),
    )

    expect(readDismissedInformationMessageIdsFromLocalStorage()).toEqual([
      "info-1",
      "info-2",
    ])
  })

  it("falls back to an empty list for malformed message storage", () => {
    window.localStorage.setItem(
      BrowserStorageKey.dismissedInformationMessageIds,
      "{",
    )

    expect(readDismissedInformationMessageIdsFromLocalStorage()).toEqual([])
  })

  it.each(["getter", "getItem"])(
    "uses read defaults when storage %s throws",
    (boundary) => {
      const fail = () => {
        throw new DOMException("Storage blocked", "SecurityError")
      }
      if (boundary === "getter")
        vi.spyOn(window, "localStorage", "get").mockImplementation(fail)
      else vi.spyOn(Storage.prototype, "getItem").mockImplementation(fail)
      expect(readDismissedInformationMessageIdsFromLocalStorage()).toEqual([])
    },
  )
})

describe("debug origin cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function openDatabase(name: string) {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onupgradeneeded = () => request.result.createObjectStore("data")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  it("deletes every database, including coordination, unknown and empty names", async () => {
    for (const name of [BROWSER_DATABASE_NAME, "unrelated", ""])
      (await openDatabase(name)).close()

    await clearOriginBrowserDatabases()

    expect(await indexedDB.databases()).toEqual([])
  })

  it("removes worker registrations, caches and private files before returning", async () => {
    const unregister = vi.fn(async () => true)
    const removeEntry = vi.fn(async () => {})
    const deleteCache = vi.fn(async () => true)
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [{ unregister }],
      },
      storage: {
        getDirectory: async () => ({
          async *keys() {
            yield "file.txt"
            yield "nested-directory"
          },
          removeEntry,
        }),
      },
    })
    vi.stubGlobal("caches", {
      keys: async () => ["cache-one", "cache-two"],
      delete: deleteCache,
    })

    await clearOriginBrowserDatabases()

    expect(unregister).toHaveBeenCalledOnce()
    expect(deleteCache.mock.calls).toEqual([["cache-one"], ["cache-two"]])
    expect(removeEntry.mock.calls).toEqual([
      ["file.txt", { recursive: true }],
      ["nested-directory", { recursive: true }],
    ])
  })

  it("reports blocked database deletion and permits retry after closing it", async () => {
    const database = await openDatabase("held-database")
    try {
      await expect(clearOriginBrowserDatabases()).rejects.toThrow(
        "Browser storage cleanup blocked",
      )
    } finally {
      database.close()
    }
    await clearOriginBrowserDatabases()
    expect(await indexedDB.databases()).toEqual([])
  })

  it("does not silently skip databases when enumeration is unavailable", async () => {
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn() })
    await expect(clearOriginBrowserDatabases()).rejects.toThrow()
  })

  it.each(["worker", "cache", "files"])(
    "reports %s cleanup failures",
    async (boundary) => {
      const fail = async () => {
        throw new Error("Storage unavailable")
      }
      vi.stubGlobal("navigator", {
        serviceWorker: {
          getRegistrations: async () =>
            boundary === "worker" ? [{ unregister: fail }] : [],
        },
        storage: boundary === "files" ? { getDirectory: fail } : {},
      })
      vi.stubGlobal("caches", {
        keys: async () => (boundary === "cache" ? ["cache"] : []),
        delete: fail,
      })
      await expect(clearOriginBrowserDatabases()).rejects.toThrow(
        "Storage unavailable",
      )
    },
  )
})
