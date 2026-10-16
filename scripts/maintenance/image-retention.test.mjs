import assert from "node:assert/strict"
import test from "node:test"
import { maintainLocalImages, selectOldImages } from "./image-retention.mjs"

const image = (id, tags, day, labels = {}) => ({
  Id: id,
  RepoTags: tags,
  Created: `2026-09-${day}T00:00:00Z`,
  Config: { Labels: labels },
})
const repositories = new Set(["aerpp-admin-test", "aerpp-support"])

test("non-boolean apply flags cannot start local image maintenance", () => {
  for (const apply of [
    "false",
    "true",
    1,
    {},
    null,
    new Boolean(false),
    Promise.resolve(false),
  ])
    assert.throws(() => maintainLocalImages(apply), /boolean/)
})

test("local retention keeps one generation, containers, deployment pins and unrelated images", () => {
  const images = [
    image("old", ["aerpp-admin-test:old"], "01"),
    image("new", ["aerpp-admin-test:new"], "03"),
    image("unrelated", ["other:old"], "01"),
    image("unknown", [], "01"),
  ]
  assert.deepEqual(
    selectOldImages(images, [], [], repositories).map((item) => item.Id),
    ["old"],
  )
  assert.deepEqual(
    selectOldImages(images, [{ Image: "old" }], [], repositories),
    [],
  )
  assert.deepEqual(
    selectOldImages(images, [], ["aerpp-admin-test:old"], repositories),
    [],
  )
  images[0].RepoTags.push("other:shared")
  assert.deepEqual(selectOldImages(images, [], [], repositories), [])
})

test("managed dangling images are bounded per environment and component", () => {
  const labels = {
    "io.aerpp.component": "support",
    "io.aerpp.environment": "test",
  }
  const images = [
    image("old", [], "01", labels),
    image("new", ["aerpp-support:test-local"], "03", labels),
    image("production", ["aerpp-support:production-local"], "02", {
      ...labels,
      "io.aerpp.environment": "production",
    }),
  ]
  assert.deepEqual(
    selectOldImages(images, [], [], repositories).map((item) => item.Id),
    ["old"],
  )
  assert.deepEqual(selectOldImages(images, [], ["old"], repositories), [])
})

test("adding management labels does not preserve an extra legacy generation", () => {
  const repositories = new Map([["aerpp-admin-test", "admin:test"]])
  const images = [
    image("old", ["aerpp-admin-test:old"], "01"),
    image("new", ["aerpp-admin-test:new"], "03", {
      "io.aerpp.component": "admin",
      "io.aerpp.environment": "test",
    }),
  ]
  assert.deepEqual(
    selectOldImages(images, [], [], repositories).map((item) => item.Id),
    ["old"],
  )
})
