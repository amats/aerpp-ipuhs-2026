/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest"
import {
  activateTabOperations,
  awaitTabResponse,
  cancelTabOperations,
  isTabOperationCurrent,
  waitForTabOperation,
} from "./tab-cancellation"
import { getTabToken, setTabToken } from "./tab-token"

const scope = "11111111-1111-1111-1111-111111111111"
beforeEach(() => {
  commitContext.mockReset()
  current.scope = scope
  current.contexts = {}
  current.recoveryRevision = 0
  activateTabOperations(`${scope}:${"a".repeat(64)}`)
})
it.each([false, undefined, null, "false", 1, {}, []])(
  "rejects a wrapped response unless context adoption explicitly succeeds: %j",
  async (committed) => {
    const token = `${scope}:${"a".repeat(64)}`
    setTabToken(token)
    commitContext.mockResolvedValueOnce(committed)
    await expect(
      awaitTabResponse(
        Promise.resolve({
          sessionToken: token,
          browserContext: "old-seal",
          browserContextRevision: 3,
        }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
  },
)
it("adopts the response only after explicit context commit success", async () => {
  const token = `${scope}:${"a".repeat(64)}`
  const nextToken = `${scope}:${"b".repeat(64)}`
  setTabToken(token)
  commitContext.mockResolvedValueOnce(true)
  const response = {
    sessionToken: nextToken,
    browserContext: "seal",
    browserContextRevision: 3,
  }
  expect(await awaitTabResponse(Promise.resolve(response))).toEqual(response)
  expect(getTabToken()).toBe(nextToken)
})

it("rejects a response cancelled while its context is being adopted", async () => {
  const token = `${scope}:${"a".repeat(64)}`
  const nextToken = `${scope}:${"b".repeat(64)}`
  setTabToken(token)
  const entered = Promise.withResolvers<void>()
  const committed = Promise.withResolvers<boolean>()
  commitContext.mockImplementationOnce(() => {
    entered.resolve()
    return committed.promise
  })
  const response = awaitTabResponse(
    Promise.resolve({
      sessionToken: nextToken,
      browserContext: "seal",
      browserContextRevision: 3,
    }),
  )
  await entered.promise
  cancelTabOperations()
  activateTabOperations(token)
  committed.resolve(true)
  await expect(response).rejects.toMatchObject({ name: "AbortError" })
  expect(getTabToken()).toBe(token)
})

it("preserves wrapped stale-state failures and enters reload guidance", async () => {
  const failure = { ok: false, reason: "browser_context_invalid" }
  expect(await awaitTabResponse(Promise.resolve(failure))).toEqual(failure)
  expect(isTabOperationCurrent()).toBe(false)
})
it.each([true, false])(
  "ignores context adoption outcome %s after only the request is cancelled",
  async (committed) => {
    const token = `${scope}:${"a".repeat(64)}`
    setTabToken(token)
    const controller = new AbortController()
    const entered = Promise.withResolvers<void>()
    const commit = Promise.withResolvers<boolean>()
    commitContext.mockImplementationOnce(() => {
      entered.resolve()
      return commit.promise
    })
    const response = awaitTabResponse(
      Promise.resolve({
        sessionToken: `${scope}:${"b".repeat(64)}`,
        browserContext: "seal",
        browserContextRevision: 3,
      }),
      controller.signal,
    )
    await entered.promise
    controller.abort()
    commit.resolve(committed)
    await expect(response).rejects.toMatchObject({ name: "AbortError" })
    expect(getTabToken()).toBe(token)
    expect(isTabOperationCurrent()).toBe(true)
  },
)

it("ends an invalidated operation immediately and consumes late rejection", async () => {
  const pending = Promise.withResolvers<never>()
  const waiting = waitForTabOperation(pending.promise)
  cancelTabOperations()
  expect(await waiting).toEqual({ ok: false, reason: "superseded_operation" })
  pending.reject(new Error("Late failure"))
  await Promise.resolve()
})
it("ignores old tab ownership metadata and checks only browser session replacement", () => {
  localStorage.setItem("aerpp-tab-owner", "irrelevant")
  expect(isTabOperationCurrent()).toBe(true)
  current.scope = "22222222-2222-2222-2222-222222222222"
  expect(isTabOperationCurrent()).toBe(false)
})
it("adopts the new state hash only for the same browser session", async () => {
  setTabToken(`${scope}:${"a".repeat(64)}`)
  const token = `${scope}:${"b".repeat(64)}`
  await waitForTabOperation(Promise.resolve({ ok: true, sessionToken: token }))
  expect(getTabToken()).toBe(token)
  await waitForTabOperation(
    Promise.resolve({
      ok: true,
      sessionToken: `22222222-2222-2222-2222-222222222222:${"c".repeat(64)}`,
    }),
  )
  expect(getTabToken()).toBe(token)
})
it("moves stale actions to reload guidance without deleting browser data", async () => {
  localStorage.setItem("result", "protected")
  await waitForTabOperation(
    Promise.resolve({ ok: false, reason: "stale_session_state" }),
  )
  expect(isTabOperationCurrent()).toBe(false)
  expect(localStorage.getItem("result")).toBe("protected")
})

const { commitContext, current } = vi.hoisted(() => ({
  commitContext: vi.fn(),
  current: {
    scope: "",
    contexts: {} as Record<string, { revision: number; value: string }>,
    recoveryRevision: 0,
  },
}))
vi.mock("./browser-database", () => ({
  readCachedBrowserSession: () => current,
}))
vi.mock("./browser-session", () => ({
  commitSessionBrowserContext: commitContext,
  readBrowserRecoveryRevision: () => current.recoveryRevision,
  isBrowserSessionCurrent: (scope: string) => scope === current.scope,
}))
it("cancels old work after administrator cleanup within the same session scope", async () => {
  const response = Promise.withResolvers<{ ok: true }>()
  const pending = waitForTabOperation(response.promise)
  current.recoveryRevision = 5
  expect(isTabOperationCurrent()).toBe(false)
  expect(await pending).toMatchObject({
    ok: false,
    reason: "superseded_operation",
  })
  response.resolve({ ok: true })
})

it("interrupts work and opens the recovery page when validation detects a grant", async () => {
  const navigate = vi.fn()
  vi.stubGlobal("window", { location: { assign: navigate } })
  try {
    expect(
      await waitForTabOperation(
        Promise.resolve({ ok: false, reason: "recovery_required" }),
      ),
    ).toMatchObject({ reason: "superseded_operation" })
    expect(navigate).toHaveBeenCalledWith("/recovery")
    expect(isTabOperationCurrent()).toBe(false)
    expect(commitContext).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
it("rejects a late context response when serialized storage refuses adoption", async () => {
  const token = `${scope}:${"a".repeat(64)}`
  setTabToken(token)
  current.contexts[scope] = { revision: 4, value: "newer-seal" }
  commitContext.mockResolvedValueOnce(false)
  expect(
    await waitForTabOperation(
      Promise.resolve({
        ok: true,
        sessionToken: token,
        browserContext: "old-seal",
        browserContextRevision: 3,
      }),
    ),
  ).toEqual({ ok: false, reason: "superseded_operation" })
  expect(commitContext).toHaveBeenCalledWith(scope, 3, "old-seal")
  expect(getTabToken()).toBe(`${token}:newer-seal`)
  expect(isTabOperationCurrent()).toBe(false)
})
