import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readSupportEnvironment } from "@aerpp/config/support"
import {
  environmentDirectory,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import { outputDirectory, privateJson } from "../shared/delivery.mjs"

export function selectCompatibleRuntime(
  current,
  baseline,
  project,
  runtimeHash,
) {
  assert.equal(current.project, project)
  assert.equal(baseline.cloud.project, project)
  assert.equal(baseline.data.project, project)
  assert.equal(baseline.cloud.image, current.image)
  assert.equal(baseline.data.runtimeSha256, runtimeHash)
  assert.equal(current.runtimeSha256, runtimeHash)
  assert.match(baseline.cloud.runtimeVersion, /^[1-9][0-9]*$/)
  assert.notEqual(baseline.cloud.runtimeVersion, current.runtimeVersion)
  return { ...current, runtimeVersion: baseline.cloud.runtimeVersion }
}

async function main() {
  const [environment, mode] = process.argv.slice(2)
  assert(["test", "production"].includes(environment))
  assert.equal(process.argv.slice(2).length, 2)
  assert(["select", "restore"].includes(mode))
  const { target, values } = prepareApplicationRuntime(
    environment,
    environmentDirectory(environment),
    { apps: "support" },
  )
  const runtime = readSupportEnvironment(values.support)
  assert.equal(runtime.admissionOpen, false)
  assert.equal(runtime.maintenanceEnabled, true)
  const runtimeHash = createHash("sha256")
    .update(values.support.SUPPORT_RUNTIME_JSON)
    .digest("hex")
  const directory = outputDirectory(environment)
  const deploymentPath = resolve(directory, "support-deployment.json")
  const recordPath = resolve(directory, "support-recovery-selection.json")
  const current = JSON.parse(readFileSync(deploymentPath))
  if (mode === "select") {
    const baseline = JSON.parse(
      readFileSync(resolve(directory, "support-mail-admission-baseline.json")),
    )
    const selected = selectCompatibleRuntime(
      current,
      baseline,
      target.project,
      runtimeHash,
    )
    writeFileSync(
      recordPath,
      JSON.stringify(
        { selectedAt: new Date().toISOString(), original: current, selected },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    )
    privateJson(deploymentPath, selected)
  } else {
    const record = JSON.parse(readFileSync(recordPath))
    assert.equal(record.original.project, target.project)
    assert.equal(record.original.runtimeSha256, runtimeHash)
    assert.deepEqual(current, record.selected)
    privateJson(deploymentPath, record.original)
    privateJson(recordPath, {
      ...record,
      restoredSelectionAt: new Date().toISOString(),
    })
  }
  console.log(
    "Compatible runtime selection recorded privately. Review a new Terraform plan before applying; this does not change cloud traffic or restore database data.",
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main()
  } catch {
    console.error(
      "Recovery selection rejected; preserve private records and review current deployment compatibility.",
    )
    process.exitCode = 1
  }
}
