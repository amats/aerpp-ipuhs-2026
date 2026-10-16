import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import {
  cloudAccountEnvironment,
  privateJson,
  toolEnvironment,
} from "./delivery.mjs"

test("Docker tooling preserves the Dev Container credential-helper socket without forwarding application secrets", () => {
  const previous = {
    REMOTE_CONTAINERS_IPC: process.env.REMOTE_CONTAINERS_IPC,
    SESSION_SEAL_PASSWORD: process.env.SESSION_SEAL_PASSWORD,
  }
  try {
    process.env.REMOTE_CONTAINERS_IPC = "/tmp/synthetic-helper.sock"
    process.env.SESSION_SEAL_PASSWORD = "synthetic-private-value"
    const env = toolEnvironment()
    assert.equal(env.REMOTE_CONTAINERS_IPC, "/tmp/synthetic-helper.sock")
    assert.equal(env.SESSION_SEAL_PASSWORD, "")
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("failed private JSON replacement leaves no temporary payload and permits retry", (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-private-json-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = resolve(directory, "receipt.json")
  mkdirSync(file)
  assert.throws(() => privateJson(file, { value: "synthetic-secret" }))
  assert.deepEqual(readdirSync(directory), ["receipt.json"])
  assert.equal(statSync(file).isDirectory(), true)
  rmSync(file, { recursive: true })
  privateJson(file, { value: "synthetic-secret" })
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    value: "synthetic-secret",
  })
  assert.equal(statSync(file).mode & 0o777, 0o600)
})

test("private JSON replacement preserves existing bytes on serialization failure and ignores stale temporary files", (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-private-json-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = resolve(directory, "receipt.json")
  writeFileSync(file, "original", { mode: 0o644 })
  assert.throws(() => privateJson(file, { invalid: 1n }))
  assert.equal(readFileSync(file, "utf8"), "original")
  assert.deepEqual(readdirSync(directory), ["receipt.json"])
  const stale = `${file}.${process.pid}.tmp`
  writeFileSync(stale, "retained stale payload", { mode: 0o600 })
  privateJson(file, { complete: true })
  assert.equal(readFileSync(stale, "utf8"), "retained stale payload")
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { complete: true })
})

test("shared image tooling uses the common private tool directory and preserves explicit overrides", () => {
  const previous = process.env.BUILDX_CONFIG
  try {
    delete process.env.BUILDX_CONFIG
    assert.match(
      toolEnvironment().BUILDX_CONFIG,
      /\/private\/tools\/docker\/shared\/buildx$/,
    )
    process.env.BUILDX_CONFIG = "/tmp/synthetic-buildx"
    assert.equal(toolEnvironment().BUILDX_CONFIG, "/tmp/synthetic-buildx")
  } finally {
    if (previous === undefined) delete process.env.BUILDX_CONFIG
    else process.env.BUILDX_CONFIG = previous
  }
})

test("cloud operations select independent accounts without inheriting credential overrides", () => {
  const configurations = ["test", "production"].map((name) => ({
    projectId: `synthetic-${name}`,
    infrastructure: { operatorAccount: `${name}@example.invalid` },
  }))
  const ambient = {
    CLOUDSDK_CORE_ACCOUNT: "wrong@example.invalid",
    CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: "/private/wrong-token",
    CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: "wrong@example.invalid",
  }
  for (const name of ["test", "production"]) {
    const env = cloudAccountEnvironment(
      `synthetic-${name}`,
      configurations,
      ambient,
    )
    assert.equal(env.CLOUDSDK_CORE_ACCOUNT, `${name}@example.invalid`)
    assert.equal(env.CLOUDSDK_AUTH_ACCESS_TOKEN_FILE, "")
    assert.equal(env.CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT, "")
  }
  assert.equal(ambient.CLOUDSDK_CORE_ACCOUNT, "wrong@example.invalid")
  assert.throws(() =>
    cloudAccountEnvironment("unselected-project", configurations, ambient),
  )
  assert.throws(() =>
    cloudAccountEnvironment(
      "synthetic-test",
      [configurations[0], configurations[0]],
      ambient,
    ),
  )
  assert.throws(() =>
    cloudAccountEnvironment(
      "synthetic-test",
      [{ projectId: "synthetic-test", infrastructure: {} }],
      ambient,
    ),
  )
})
