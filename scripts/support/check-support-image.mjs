import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { syntheticRuntime } from "../../apps/support/test-support/runtime.ts"
import {
  outputDirectory,
  privateJson,
  readJson,
  run,
} from "../shared/delivery.mjs"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
  sourceProvenance,
} from "../shared/source-provenance.mjs"

async function probe() {
  const assert = (await import("node:assert/strict")).default
  const base = "http://127.0.0.1:8080"
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (
        (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }))
          .ok
      ) {
        ready = true
        break
      }
    } catch {}
    await new Promise((accept) => setTimeout(accept, 250))
  }
  assert(ready, "Support image did not become ready")
  assert.notEqual(process.getuid(), 0)
  for (const path of ["/", "/privacy", "/terms", "/contact", "/email/confirm"])
    assert.equal((await fetch(base + path)).status, 200)
  assert.equal((await fetch(`${base}/api/participant/information`)).status, 401)
  assert.equal(
    (await fetch(`${base}/maintenance/withdrawal-cleanup`, { method: "POST" }))
      .status,
    401,
  )
  assert.equal(
    (await fetch(`${base}/email/confirm`, { method: "POST" })).status,
    503,
  )
  assert.equal((await fetch(`${base}/unknown`)).status, 404)
  const { spawnSync } = await import("node:child_process")
  const missing = spawnSync(process.execPath, ["dist/server.mjs"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SUPPORT_RUNTIME_JSON: "" },
    timeout: 10000,
  })
  assert.equal(missing.status, 1, "Missing settings must reject startup")
}
const temporary = mkdtempSync(resolve(tmpdir(), "aerpp-support-image-"))
let container
try {
  const [environment, ...extra] = process.argv.slice(2)
  assert(
    ["test", "production"].includes(environment) && extra.length === 0,
    "Usage: support:check-image test|production",
  )
  const directory = outputDirectory(environment)
  const manifest = readJson(
    resolve(directory, "support-image.json"),
    "Support image metadata",
  )
  assert.equal(manifest.environment, environment)
  assertMatchingSource(manifest, readSourceState())
  const inspection = JSON.parse(
    run("docker", ["image", "inspect", manifest.imageId]),
  )[0]
  assert.equal(inspection.Architecture, "amd64")
  assert.equal(inspection.Config.User, "node")
  assertImageSource(manifest, inspection)
  const runtime = syntheticRuntime()
  runtime.admissionOpen = false
  runtime.maintenanceEnabled = false
  const environmentFile = resolve(temporary, "runtime.env")
  writeFileSync(
    environmentFile,
    `SUPPORT_RUNTIME_JSON=${JSON.stringify(runtime)}\nFIRESTORE_EMULATOR_HOST=127.0.0.1:9\n`,
    { mode: 0o600 },
  )
  container = run("docker", [
    "run",
    "--detach",
    "--platform=linux/amd64",
    "--network=none",
    "--env-file",
    environmentFile,
    manifest.imageId,
  ])
  run("docker", [
    "exec",
    container,
    "node",
    "--input-type=module",
    "-e",
    `await (${probe.toString()})()`,
  ])
  assertMatchingSource(readSourceState(), manifest)
  privateJson(resolve(directory, "support-image-check.json"), {
    ...sourceProvenance(manifest),
    _comment: "Generated offline container evidence; do not edit",
    imageId: manifest.imageId,
    checkedAt: new Date().toISOString(),
    network: "none",
    publicPages: true,
    protectedRoutes: true,
    missingConfigurationRejected: true,
  })
  console.log(
    "Support image checks passed without network access or real credentials",
  )
} catch {
  console.error("Support image check failed; inspect the private tool log")
  process.exitCode = 1
} finally {
  try {
    if (container) run("docker", ["rm", "--force", container])
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
