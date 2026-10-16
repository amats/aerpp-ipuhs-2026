import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fixtureSource } from "../../../test-support/research-fixtures"

const snapshot = vi.hoisted(() => vi.fn())
vi.mock("server-only", () => ({}))
vi.mock("@/lib/firestore", () => ({ firestore: {} }))
vi.mock("@aerpp/firestore/participant-snapshot", () => ({
  readParticipantResearchSnapshot: snapshot,
}))

import { readResearchSource } from "./research-source"

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

it.each([false, true])(
  "reads the requested snapshot without adding a deadline when includeAccess=%s",
  async (includeAccess) => {
    const source = fixtureSource()
    snapshot.mockResolvedValueOnce(source)
    expect(await readResearchSource(includeAccess)).toBe(source)
    expect(snapshot).toHaveBeenCalledExactlyOnceWith({}, { includeAccess })
  },
)

it("does not start a snapshot read for an already aborted export", async () => {
  const controller = new AbortController()
  const error = new Error("export cancelled")
  controller.abort(error)
  await expect(
    readResearchSource(false, { signal: controller.signal }),
  ).rejects.toBe(error)
  expect(snapshot).not.toHaveBeenCalled()
})

it.each(["success", "failure", "abort"])(
  "removes its cancellation listener after %s",
  async (outcome) => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const source = fixtureSource()
    const pendingSnapshot = Promise.withResolvers<typeof source>()
    snapshot.mockReturnValueOnce(pendingSnapshot.promise)
    const pending = readResearchSource(false, { signal: controller.signal })
    if (outcome === "success") {
      pendingSnapshot.resolve(source)
      expect(await pending).toBe(source)
    } else {
      const error = new Error(outcome)
      const rejected = expect(pending).rejects.toBe(error)
      if (outcome === "abort") controller.abort(error)
      else pendingSnapshot.reject(error)
      await rejected
    }
    expect(remove).toHaveBeenCalledExactlyOnceWith(
      "abort",
      expect.any(Function),
    )
  },
)
