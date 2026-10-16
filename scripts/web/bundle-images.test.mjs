import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { exportBundleImages } from "./bundle-images.mjs"

test("Docker export preserves portable tags and both Docker image identities", () => {
  for (const config of [
    `blobs/sha256/${"b".repeat(64)}`,
    `${"b".repeat(64)}.json`,
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "aerpp-image-export-"))
    try {
      const calls = []
      const images = [
        {
          service: "app-aerpp",
          id: `sha256:${"a".repeat(64)}`,
          platform: "linux/arm64",
        },
      ]
      exportBundleImages(
        images,
        "test-synthetic",
        directory,
        (command, args) => {
          calls.push([command, ...args])
          if (args[0] === "save") writeFileSync(args[2], "synthetic")
          if (command === "tar")
            return JSON.stringify([
              {
                Config: config,
                RepoTags: ["aerpp-bundle/app-aerpp:test-synthetic"],
              },
            ])
          return ""
        },
      )
      assert.equal(images[0].configId, `sha256:${"b".repeat(64)}`)
      assert.equal(images[0].reference, "aerpp-bundle/app-aerpp:test-synthetic")
      assert.deepEqual(calls.find((call) => call[1] === "save").slice(4), [
        images[0].reference,
      ])
      assert.deepEqual(calls.at(-1), [
        "docker",
        "image",
        "rm",
        images[0].reference,
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

test("Docker export attempts every temporary tag removal after a cleanup failure", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-image-export-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const images = ["app-aerpp", "caddy", "fluent-bit"].map((service) => ({
    service,
    id: `sha256:${"a".repeat(64)}`,
  }))
  const removed = []
  assert.throws(
    () =>
      exportBundleImages(
        images,
        "test-synthetic",
        directory,
        (command, args) => {
          if (args[0] === "save") writeFileSync(args[2], "synthetic")
          if (command === "tar")
            return JSON.stringify(
              images.map((image) => ({
                Config: `${"b".repeat(64)}.json`,
                RepoTags: [image.reference],
              })),
            )
          if (args[0] === "image") {
            removed.push(args[2])
            if (removed.length === 1)
              throw new Error("synthetic cleanup failure")
          }
          return ""
        },
      ),
    /Failed to remove temporary bundle image tags/,
  )
  assert.deepEqual(
    removed,
    images.map((image) => image.reference),
  )
})

test("Docker export preserves its original failure and cleans every successfully created tag", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-image-export-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const failure of ["tag", "save", "manifest"]) {
    const images = ["app-aerpp", "caddy", "fluent-bit"].map((service) => ({
      service,
      id: `sha256:${"a".repeat(64)}`,
    }))
    const original = new Error(`synthetic ${failure} failure`)
    const tagged = []
    const removed = []
    assert.throws(
      () =>
        exportBundleImages(
          images,
          "test-synthetic",
          directory,
          (command, args) => {
            if (args[0] === "tag") {
              if (failure === "tag" && tagged.length === 2) throw original
              tagged.push(args[2])
            }
            if (args[0] === "save") {
              if (failure === "save") throw original
              writeFileSync(args[2], "synthetic")
            }
            if (command === "tar") throw original
            if (args[0] === "image") {
              removed.push(args[2])
              if (removed.length === 1)
                throw new Error("synthetic cleanup failure")
            }
            return ""
          },
        ),
      (error) => error === original,
    )
    assert.deepEqual(removed, tagged)
  }
})
