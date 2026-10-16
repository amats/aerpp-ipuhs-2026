import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ROOT } from "@aerpp/config/workspace"
import { main as pruneSecrets } from "../../cloud/prune-secrets.mjs"
import { privateJson, run } from "../../shared/delivery.mjs"
import { exportTerraformOutputs } from "./outputs.mjs"
import { reviewSavedTerraformPlan } from "./saved-plan.mjs"

export function executeTerraformOperation(
  {
    project,
    environment,
    region,
    directory,
    moduleDirectory,
    sourceFingerprint,
    action,
    target,
    metadata,
    inputs,
    recoveryMode,
    bucket,
    configurationDirectory,
  },
  env,
  { runCommand = run } = {},
) {
  env.TF_DATA_DIR = resolve(directory, ".terraform")
  env.TF_IN_AUTOMATION = "1"
  const localTool = resolve(ROOT, "private/tools/terraform/terraform")
  const terraform = existsSync(localTool) ? localTool : "terraform"
  const log = resolve(directory, "terraform.log")
  const invoke = (command, capture = false) =>
    runCommand(terraform, [`-chdir=${moduleDirectory}`, ...command], {
      env,
      ...(capture ? {} : { log }),
    })
  // Backend input is JSON data, not an HCL backend file.
  invoke([
    "init",
    "-input=false",
    "-lockfile=readonly",
    `-backend-config=bucket=${bucket}`,
    "-backend-config=prefix=support/foundation",
  ])
  invoke(["validate", "-no-color"])
  const exportOutputs = () =>
    exportTerraformOutputs({
      invoke,
      target,
      region,
      metadata,
      configurationDirectory,
      directory,
      sourceFingerprint,
    })
  if (action === "outputs") {
    const appliedFile = resolve(directory, "applied.json")
    if (
      !existsSync(appliedFile) ||
      JSON.parse(readFileSync(appliedFile, "utf8")).sourceFingerprint !==
        sourceFingerprint
    )
      throw new Error(
        "Apply the current reviewed Terraform configuration before exporting outputs",
      )
    exportOutputs()
    console.log("Applied Terraform outputs projected into private auto.json")
    return
  }
  const { plan, planFile } = reviewSavedTerraformPlan({
    action,
    recoveryMode,
    directory,
    inputs,
    sourceFingerprint,
    project,
    region,
    invoke,
  })
  if (action === "apply") {
    // Firestore wildcard policies and field overrides share collection metadata.
    // Apply serially to avoid 409 contention during creation or retirement.
    invoke(["apply", "-input=false", "-no-color", "-parallelism=1", planFile])
    privateJson(resolve(directory, "applied.json"), {
      _comment: "Generated evidence; do not edit",
      project,
      region,
      sourceFingerprint,
      appliedAt: new Date().toISOString(),
      resources: (plan.resource_changes ?? []).map((item) => ({
        address: item.address,
        actions: item.change.actions,
      })),
    })
    if (recoveryMode !== undefined) {
      console.log(
        `${environment} reviewed Firestore ${recoveryMode} applied; run a fresh foundation plan`,
      )
      return
    }
    exportOutputs()
    if (inputs.deployment) {
      console.log(
        "Terraform apply completed; pruning unprotected Support secret versions",
      )
      try {
        pruneSecrets([environment, "--apply"], "support")
      } catch {
        throw new Error(
          "Terraform apply completed, but secret cleanup failed; inspect private retention evidence and rerun cloud:secrets for this environment",
        )
      }
    }
  }
  console.log(
    `${environment} infrastructure ${action} completed; private evidence recorded`,
  )
}
