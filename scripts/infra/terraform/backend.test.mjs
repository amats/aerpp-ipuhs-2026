import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { prepareTerraformBackend } from "./backend.mjs"

function fixture(t, existing = false) {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-backend-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const context = {
    project: "synthetic-test",
    environment: "test",
    region: "asia-northeast1",
    directory,
    foundationDirectory: directory,
    action: "bootstrap",
  }
  const bucket = "aerpp-tf-test-123456"
  const calls = []
  const execute = (project, args) => {
    assert.equal(project, context.project)
    calls.push(args)
    if (args[0] === "projects")
      return JSON.stringify({ projectNumber: "123456" })
    if (args[2] === "list")
      return JSON.stringify(existing ? [{ name: bucket }] : [])
    if (args[2] === "describe")
      return JSON.stringify({
        versioning_enabled: true,
        uniform_bucket_level_access: true,
        public_access_prevention: "enforced",
        location: "ASIA-NORTHEAST1",
      })
    return ""
  }
  return { context, bucket, calls, execute }
}

test("bootstrap creates a protected backend and subsequent operations bind its exact target", (t) => {
  const f = fixture(t)
  assert.deepEqual(prepareTerraformBackend(f.context, f.execute), {
    bootstrapped: true,
  })
  const create = f.calls.find((args) => args[2] === "create")
  assert(create.includes("--uniform-bucket-level-access"))
  assert(create.includes("--public-access-prevention"))
  const file = resolve(f.context.directory, "backend.json")
  assert.deepEqual(JSON.parse(readFileSync(file)), {
    bucket: f.bucket,
    prefix: "support/foundation",
  })
  const result = prepareTerraformBackend(
    { ...f.context, action: "plan" },
    f.execute,
  )
  assert.equal(result.bucket, f.bucket)
  writeFileSync(
    file,
    JSON.stringify({ bucket: "another-bucket", prefix: "support/foundation" }),
  )
  assert.throws(
    () => prepareTerraformBackend({ ...f.context, action: "apply" }, f.execute),
    /Backend target mismatch/,
  )
})

test("an existing bucket without matching ownership is rejected before any bucket write", (t) => {
  const f = fixture(t, true)
  assert.throws(
    () => prepareTerraformBackend(f.context, f.execute),
    /ownership record/,
  )
  assert.deepEqual(
    f.calls.map((args) => args[2]),
    [f.context.project, "list"],
  )
})
