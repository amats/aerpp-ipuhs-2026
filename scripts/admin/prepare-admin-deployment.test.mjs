import assert from "node:assert/strict"
import { test } from "node:test"
import { cloudEnvironment, toolEnvironment } from "../shared/delivery.mjs"
import {
  resolveDeploymentImage,
  validateImage,
} from "./prepare-admin-deployment.mjs"

const SOURCE = {
  sourceRevision: "a".repeat(40),
  sourceTree: "b".repeat(40),
  sourceDirty: false,
}
const imageId = `sha256:${"a".repeat(64)}`
const target = { name: "test", project: "synthetic-test" }
const manifest = {
  ...SOURCE,
  version: 1,
  environment: "test",
  project: "synthetic-test",
  platform: "linux/amd64",
  imageId,
}
const inspection = {
  Id: imageId,
  Architecture: "amd64",
  Os: "linux",
  Config: {
    Labels: {
      "io.aerpp.environment": "test",
      "org.opencontainers.image.revision": SOURCE.sourceRevision,
      "io.aerpp.source-tree": SOURCE.sourceTree,
    },
  },
}
test("deployment resolves an attested index to the checked AMD64 image and rejects ambiguity or content drift", () => {
  const reference = `registry.example.com/admin@sha256:${"b".repeat(64)}`
  const digest = `sha256:${"c".repeat(64)}`
  const entry = { digest, platform: { os: "linux", architecture: "amd64" } }
  const child = `registry.example.com/admin@${digest}`
  const calls = []
  assert.equal(
    resolveDeploymentImage(reference, imageId, (ref) => {
      calls.push(ref)
      return ref === reference
        ? {
            manifests: [
              entry,
              { platform: { os: "unknown", architecture: "unknown" } },
            ],
          }
        : { config: { digest: imageId } }
    }),
    child,
  )
  assert.deepEqual(calls, [reference, child])
  assert.equal(
    resolveDeploymentImage(reference, reference.split("@")[1], (ref) =>
      ref === reference
        ? { manifests: [entry] }
        : { config: { digest: imageId } },
    ),
    child,
  )
  assert.equal(
    resolveDeploymentImage(reference, imageId, () => ({
      config: { digest: imageId },
    })),
    reference,
  )
  for (const manifests of [
    [],
    [entry, entry],
    [{ ...entry, digest: "invalid" }],
    [{ ...entry, platform: { os: "linux", architecture: "arm64" } }],
  ])
    assert.throws(() =>
      resolveDeploymentImage(reference, imageId, () => ({ manifests })),
    )
  assert.throws(
    () =>
      resolveDeploymentImage(reference, imageId, () => ({
        config: { digest },
      })),
    /does not match/,
  )
})
test("deployment binds the inspected image to the selected project and architecture", () => {
  validateImage(manifest, inspection, target)
  for (const change of [
    { project: "synthetic-production" },
    { environment: "production" },
    { platform: "linux/arm64" },
    { imageId: `sha256:${"b".repeat(64)}` },
  ])
    assert.throws(() =>
      validateImage({ ...manifest, ...change }, inspection, target),
    )
  assert.throws(() =>
    validateImage(manifest, { ...inspection, Architecture: "arm64" }, target),
  )
})
test("tool children do not inherit ambient application credentials or project aliases", () => {
  const old = process.env.GOOGLE_APPLICATION_CREDENTIALS
  try {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/private/production.json"
    assert.equal(toolEnvironment().GOOGLE_APPLICATION_CREDENTIALS, "")
    assert.equal(toolEnvironment().GCP_PROJECT_ID, "")
    assert.throws(() => cloudEnvironment("ipuhs"))
    assert.throws(() => cloudEnvironment(undefined))
  } finally {
    if (old === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = old
  }
})
