import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { gcloud, privateJson } from "../../shared/delivery.mjs"

export function prepareTerraformBackend(
  { project, environment, region, directory, foundationDirectory, action },
  execute = gcloud,
) {
  const metadata = JSON.parse(
    execute(project, [
      "projects",
      "describe",
      project,
      "--format=json(projectNumber)",
    ]),
  )
  if (!/^[0-9]+$/.test(metadata.projectNumber))
    throw new Error("Invalid project number")
  const bucket = `aerpp-tf-${environment}-${metadata.projectNumber}`
  const bucketUri = `gs://${bucket}`
  const bootstrapRecord = resolve(foundationDirectory, "bootstrap.json")
  const backendFile = resolve(foundationDirectory, "backend.json")
  if (action === "bootstrap") {
    const buckets = JSON.parse(
      execute(project, ["storage", "buckets", "list", "--format=json(name)"]),
    )
    if (!buckets.some((item) => item.name === bucket)) {
      execute(project, [
        "storage",
        "buckets",
        "create",
        bucketUri,
        `--location=${region}`,
        "--uniform-bucket-level-access",
        "--public-access-prevention",
      ])
      privateJson(bootstrapRecord, {
        _comment: "Generated bootstrap ownership record; do not edit",
        project,
        bucket,
        region,
      })
    } else if (
      !existsSync(bootstrapRecord) ||
      JSON.parse(readFileSync(bootstrapRecord, "utf8")).bucket !== bucket
    ) {
      throw new Error(
        "Existing state bucket has no matching bootstrap ownership record; inspect before adopting",
      )
    }
    execute(project, [
      "storage",
      "buckets",
      "update",
      bucketUri,
      "--versioning",
    ])
    const state = JSON.parse(
      execute(project, [
        "storage",
        "buckets",
        "describe",
        bucketUri,
        "--format=json",
      ]),
    )
    if (
      state.versioning_enabled !== true ||
      state.public_access_prevention !== "enforced" ||
      state.uniform_bucket_level_access !== true ||
      state.location?.toLowerCase() !== region
    )
      throw new Error("State bucket protection validation failed")
    privateJson(resolve(directory, "bucket.json"), state)
    privateJson(backendFile, { bucket, prefix: "support/foundation" })
    return { bootstrapped: true }
  }
  if (!existsSync(backendFile))
    throw new Error("Run infra:terraform <environment> bootstrap first")
  const backend = JSON.parse(readFileSync(backendFile, "utf8"))
  if (backend.bucket !== bucket || backend.prefix !== "support/foundation")
    throw new Error("Backend target mismatch")
  return { metadata, bucket, backend }
}
