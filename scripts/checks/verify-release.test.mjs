import assert from "node:assert/strict"
import test from "node:test"
import { RELEASE_CHECKS, verifyRelease } from "./verify-release.mjs"

const SOURCE = {
  sourceRevision: "a".repeat(40),
  sourceTree: "b".repeat(40),
  sourceDirty: false,
}
test("release verification binds all gates to unchanged source and preserves failures", () => {
  assert.equal(
    verifyRelease({
      readSource: () => SOURCE,
      runChecks: ({ steps }) => {
        assert.deepEqual(steps, RELEASE_CHECKS)
        assert.equal(steps.at(-1).at(-1), "audit:release")
        return 0
      },
    }),
    0,
  )
  assert.equal(
    verifyRelease({ readSource: () => SOURCE, runChecks: () => 17 }),
    17,
  )
  for (const changed of [
    { ...SOURCE, sourceRevision: "c".repeat(40) },
    { ...SOURCE, sourceDirty: true },
  ]) {
    let reads = 0
    assert.throws(() =>
      verifyRelease({
        readSource: () => (++reads === 1 ? SOURCE : changed),
        runChecks: () => 0,
      }),
    )
  }
})
