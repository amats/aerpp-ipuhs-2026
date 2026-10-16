import assert from "node:assert/strict"
import { readFileSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { environmentTarget } from "@aerpp/config/targets"
import { main as pruneSecrets } from "../cloud/prune-secrets.mjs"
import { gcloud, outputDirectory, privateJson } from "../shared/delivery.mjs"
import { checkRevision } from "./check-admin-cloud.mjs"

try {
  const [environment, mode] = process.argv.slice(2)
  assert(["test", "production"].includes(environment))
  assert.equal(process.argv.slice(2).length, 2)
  assert(["stage", "accept"].includes(mode))
  const { project } = environmentTarget(environment)
  const directory = outputDirectory(environment)
  const file = resolve(directory, "admin-prepared.json")
  const prepared = JSON.parse(readFileSync(file))
  assert.equal(prepared.project, project)
  assert.equal(prepared.environment, environment)
  const service = JSON.parse(
    gcloud(project, [
      "run",
      "services",
      "describe",
      prepared.deployment.service,
      `--region=${prepared.deployment.region}`,
      "--format=json",
    ]),
  )
  const revision = service.status.latestCreatedRevisionName
  const actual = JSON.parse(
    gcloud(project, [
      "run",
      "revisions",
      "describe",
      revision,
      `--region=${prepared.deployment.region}`,
      "--format=json",
    ]),
  )
  assert(
    actual.status.conditions.some(
      (c) => c.type === "Ready" && c.status === "True",
    ),
  )
  checkRevision(actual, prepared)
  if (mode === "stage") {
    privateJson(file, {
      ...prepared,
      trafficRevision: revision,
      verifiedRevision: revision,
      stagedAt: new Date().toISOString(),
    })
    console.log(
      "Ready revision matches the prepared image and runtime; review another Terraform plan to promote traffic.",
    )
  } else {
    assert.equal(prepared.verifiedRevision, revision)
    assert.equal(service.status.traffic.length, 1)
    assert.equal(service.status.traffic[0].revisionName, revision)
    assert.equal(service.status.traffic[0].percent, 100)
    const { trafficRevision, verifiedRevision, ...record } = prepared
    privateJson(resolve(directory, "admin-deployed.json"), {
      ...record,
      revision,
      deployedAt: new Date().toISOString(),
      acceptance: "pending",
    })
    renameSync(
      file,
      resolve(directory, `admin-prepared-accepted-${Date.now()}.json`),
    )
    console.log(
      "Terraform traffic promotion recorded; run admin:check-cloud for the selected environment and keep real OAuth acceptance separate.",
    )
    try {
      pruneSecrets([environment, "--apply"], "admin")
    } catch {
      console.error(
        "Promotion was recorded, but secret cleanup failed; inspect private retention evidence and rerun cloud:secrets for this environment.",
      )
      process.exitCode = 1
    }
  }
} catch {
  console.error(
    "Admin Terraform promotion rejected; preserve prepared metadata and inspect private deployment evidence.",
  )
  process.exitCode = 1
}
