import assert from "node:assert/strict"
import test from "node:test"
import { assertPreparation, main } from "./prepare-support-deployment.mjs"

const SOURCE = {
  sourceRevision: "a".repeat(40),
  sourceTree: "b".repeat(40),
  sourceDirty: false,
}
const id = `sha256:${"a".repeat(64)}`
const runtime = {
  environment: "test",
  admissionOpen: false,
  maintenanceEnabled: false,
}
const manifest = {
  ...SOURCE,
  environment: "test",
  imageId: id,
}
const checked = {
  ...SOURCE,
  imageId: id,
  network: "none",
  publicPages: true,
  protectedRoutes: true,
  missingConfigurationRejected: true,
}
const image = {
  Id: id,
  Os: "linux",
  Architecture: "amd64",
  Config: {
    User: "node",
    Labels: {
      "org.opencontainers.image.revision": SOURCE.sourceRevision,
      "io.aerpp.source-tree": SOURCE.sourceTree,
    },
  },
}
test("preparation accepts selected cloud environments and gates admission", () => {
  assert.doesNotThrow(() =>
    assertPreparation(runtime, manifest, checked, image),
  )
  for (const change of [{ environment: "local" }, { admissionOpen: true }])
    assert.throws(() =>
      assertPreparation({ ...runtime, ...change }, manifest, checked, image),
    )
  assert.doesNotThrow(() =>
    assertPreparation(
      { ...runtime, environment: "production", maintenanceEnabled: true },
      { ...manifest, environment: "production" },
      checked,
      image,
    ),
  )
  assert.throws(() =>
    assertPreparation(
      { ...runtime, environment: "production" },
      manifest,
      checked,
      image,
    ),
  )
  assert.throws(() => main(["test"]))
  assert.throws(() => main(["production", "--apply", "--unknown"]))
  assert.throws(() => main(["test", "--unknown"]))
  assert.throws(() => main(["test", "--apply", "--unknown"]))
})
test("preparation requires matching verified non-root image", () => {
  for (const change of [
    { imageId: "other" },
    { network: "cloud" },
    { protectedRoutes: false },
    { missingConfigurationRejected: false },
  ])
    assert.throws(() =>
      assertPreparation(runtime, manifest, { ...checked, ...change }, image),
    )
  assert.throws(() =>
    assertPreparation(runtime, manifest, checked, {
      ...image,
      Config: { User: "root" },
    }),
  )
})

test("preparation requires explicit successful container check results", () => {
  for (const field of [
    "publicPages",
    "protectedRoutes",
    "missingConfigurationRejected",
  ]) {
    for (const value of [false, "false", 1, {}, [], null, undefined]) {
      assert.throws(
        () =>
          assertPreparation(
            runtime,
            manifest,
            { ...checked, [field]: value },
            image,
          ),
        /Build and verify the support image before preparation/,
        `${field} must be true, received ${JSON.stringify(value)}`,
      )
    }
  }
})
