import assert from "node:assert/strict"
import { test } from "node:test"
import { selectCompatibleRuntime } from "./select-support-recovery.mjs"

test("recovery selection requires the same project, image and exact runtime fingerprint", () => {
  const current = {
    project: "synthetic-test",
    image: "digest",
    runtimeVersion: "3",
    runtimeSha256: "hash",
  }
  const baseline = {
    cloud: {
      project: current.project,
      image: current.image,
      runtimeVersion: "1",
    },
    data: { project: current.project, runtimeSha256: "hash" },
  }
  assert.deepEqual(
    selectCompatibleRuntime(current, baseline, current.project, "hash"),
    { ...current, runtimeVersion: "1" },
  )
  for (const patch of [
    { project: "other" },
    { image: "other" },
    { runtimeVersion: "latest" },
    { runtimeVersion: "3" },
  ]) {
    const changed = structuredClone(baseline)
    Object.assign(changed.cloud, patch)
    assert.throws(() =>
      selectCompatibleRuntime(current, changed, current.project, "hash"),
    )
  }
  assert.throws(() =>
    selectCompatibleRuntime(current, baseline, current.project, "changed"),
  )
  assert.throws(() =>
    selectCompatibleRuntime(
      current,
      { ...baseline, data: { project: current.project, runtimeSha256: "old" } },
      current.project,
      "hash",
    ),
  )
})
