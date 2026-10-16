import assert from "node:assert/strict"
import { chmodSync } from "node:fs"
import { resolve } from "node:path"
import { run } from "../shared/delivery.mjs"

export function exportBundleImages(
  images,
  releaseId,
  destination,
  invoke = run,
) {
  assert.match(releaseId, /^[a-z0-9][a-z0-9._-]*$/)
  const tagged = []
  let cleanupFailed = false
  try {
    for (const image of images) {
      assert(["app-aerpp", "caddy", "fluent-bit"].includes(image.service))
      image.reference = `aerpp-bundle/${image.service}:${releaseId}`
      invoke("docker", ["tag", image.id, image.reference])
      tagged.push(image.reference)
    }
    const archive = resolve(destination, "images.tar")
    invoke("docker", ["save", "-o", archive, ...tagged])
    chmodSync(archive, 0o600)
    const manifest = JSON.parse(
      invoke("tar", ["-xOf", archive, "manifest.json"]),
    )
    for (const image of images) {
      const entries = manifest.filter((entry) =>
        entry.RepoTags?.includes(image.reference),
      )
      assert.equal(entries.length, 1, "Expected one platform per bundled image")
      // Classic Docker identifies images by config digest; containerd may use the index digest.
      const match = /^(?:blobs\/sha256\/)?([a-f0-9]{64})(?:\.json)?$/.exec(
        entries[0].Config,
      )
      assert(match, "Invalid image configuration digest in Docker archive")
      image.configId = `sha256:${match[1]}`
    }
  } finally {
    for (const reference of tagged) {
      try {
        invoke("docker", ["image", "rm", reference])
      } catch {
        cleanupFailed = true
      }
    }
  }
  if (cleanupFailed === true)
    throw new Error("Failed to remove temporary bundle image tags")
}
