import { randomUUID } from "node:crypto"
import { IDBFactory } from "fake-indexeddb"
import { act } from "react"
import { afterEach, beforeEach, vi } from "vitest"

beforeEach(() => {
  if (typeof window !== "undefined")
    vi.stubGlobal("indexedDB", new IDBFactory())
})

const reactRoots = vi.hoisted(() => new Set<{ unmount: () => void }>())

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>()

  return {
    ...actual,
    createRoot: (
      ...args: Parameters<typeof actual.createRoot>
    ): ReturnType<typeof actual.createRoot> => {
      const root = actual.createRoot(...args)
      reactRoots.add(root)

      return root
    },
  }
})

vi.mock("server-only", () => ({}))

afterEach(() => {
  act(() => {
    for (const root of reactRoots) {
      root.unmount()
    }
    reactRoots.clear()
  })
})

process.env.PARTICIPANT_API_SERVER_ID ??= "test-server"
process.env.IDENTIFIER_HASH_SECRET ??= "test-server-key"
// Each isolated test file gets its own synthetic SQLite authority namespace.
// Production limits must not be consumed by unrelated files or earlier runs.
process.env.SESSION_SEAL_PASSWORD = `synthetic-test-session-${randomUUID()}`
process.env.AERPP_ENVIRONMENT = "test"
process.env.SUPPORT_API_BASE_URL = "https://support.example.invalid"
process.env.SUPPORT_API_CREDENTIAL = `synthetic.${"a".repeat(43)}`
process.env.SUPPORT_RECEPTION_EXPIRES_AT = "2099-01-01T00:00:00Z"
process.env.SUPPORT_CONTACT_EMAIL = "support@example.invalid"

process.env.AERPP_WEB_DOCUMENT_SET = JSON.stringify({
  version: "1.0",
  sha256: "a".repeat(64),
})
