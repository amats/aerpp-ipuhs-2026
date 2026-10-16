import assert from "node:assert/strict"
import test from "node:test"
import { selectRegistryDeletion } from "./prune-images.mjs"

const digest = (n) => `sha256:${String(n).repeat(64)}`
const images = [1, 2, 3, 4, 5, 6].map((n) => ({
  version: digest(n),
  package: "app",
  createTime: `2026-09-0${n}T00:00:00Z`,
}))
const manifests = Object.fromEntries(images.map((image) => [image.version, {}]))
manifests[digest(3)] = {
  manifests: [{ digest: digest(1) }, { digest: digest(2) }],
}
manifests[digest(6)] = {
  manifests: [{ digest: digest(4) }, { digest: digest(5) }],
}
const now = Date.parse("2026-09-10T00:00:00Z")

test("registry pruning keeps complete latest image families and deletes parents before children", () => {
  const candidates = selectRegistryDeletion(images, manifests, [], now)
  assert.deepEqual(new Set(candidates), new Set([1, 2, 3].map(digest)))
  assert.equal(candidates[0], digest(3))
  assert.deepEqual(
    selectRegistryDeletion(images, manifests, [digest(1)], now),
    [],
  )
})

test("registry pruning fails closed on missing live images or children and honors preparation grace", () => {
  assert.throws(() =>
    selectRegistryDeletion(images, manifests, [digest(7)], now),
  )
  assert.throws(
    () => selectRegistryDeletion(images.slice(1), manifests, [], now),
    /manifest graph/,
  )
  assert.throws(() => selectRegistryDeletion(images, {}, [], now), /manifest/)
  const fresh = images.map((image) => ({
    ...image,
    createTime: "2026-09-09T23:00:00Z",
  }))
  assert.deepEqual(selectRegistryDeletion(fresh, manifests, [], now), [])
  const recent = images.map((image) => ({
    ...image,
    createTime: `2026-09-09T23:00:0${image.version.at(-1)}Z`,
  }))
  assert.equal(selectRegistryDeletion(recent, manifests, [], now, 0).length, 3)
})
