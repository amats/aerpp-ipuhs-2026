import { mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { environmentTarget } from "@aerpp/config/targets"
import { environmentDirectory, ROOT } from "@aerpp/config/workspace"
import { collectImageRetentionPins } from "../cloud/image-retention-policy.mjs"
import { cli, outputDirectory, run } from "../shared/delivery.mjs"
import { withTerraformOperatorAuth } from "./operator-auth.mjs"
import { prepareTerraformBackend } from "./terraform/backend.mjs"
import { executeTerraformOperation } from "./terraform/execute.mjs"
import { buildTerraformInputs } from "./terraform/inputs.mjs"
import { foundationSourceFingerprint } from "./terraform/plan-provenance.mjs"

export function runTerraformInfrastructure(args) {
  const selectedArgs = args
  const [environment, operation] = selectedArgs
  const recovery = /^(close-admission|recover-fields)-(plan|apply)$/.exec(
    operation ?? "",
  )
  const recoveryMode = recovery?.[1]
  const action = recovery?.[2] ?? operation
  if (
    selectedArgs.length !== 2 ||
    !["test", "production"].includes(environment) ||
    !["bootstrap", "plan", "apply", "outputs"].includes(action)
  )
    throw new Error(
      "Usage: infra:terraform test|production bootstrap|plan|apply|outputs|close-admission-plan|close-admission-apply|recover-fields-plan|recover-fields-apply",
    )
  const target = environmentTarget(environment)
  const { project } = target
  const config = JSON.parse(
    readFileSync(
      resolve(environmentDirectory(environment), "config.json"),
      "utf8",
    ),
  )
  if (recoveryMode !== undefined && config.support?.admissionOpen !== false)
    throw new Error(
      "Firestore recovery requires closed admission in the selected configuration",
    )
  if (recoveryMode !== undefined && recoveryMode !== "close-admission")
    run("node", ["scripts/support/check-support-cloud.mjs", environment])
  const configurationDirectory = environmentDirectory(environment)
  const inputs = buildTerraformInputs(
    config,
    target,
    configurationDirectory,
    outputDirectory(environment),
  )
  const { region } = inputs
  const foundationDirectory = resolve(
    outputDirectory(environment),
    "support-terraform",
  )
  const directory =
    recoveryMode === undefined
      ? foundationDirectory
      : resolve(foundationDirectory, recoveryMode)
  inputs.image_retention_pins = collectImageRetentionPins(
    project,
    region,
    inputs.admin,
    inputs.deployment,
  )
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const state = prepareTerraformBackend({
    project,
    environment,
    region,
    directory,
    foundationDirectory,
    action,
  })
  if (state.bootstrapped === true) {
    console.log(
      "Private selected state bucket created/verified with versioning and public access prevention",
    )
    return
  }
  const { metadata, bucket, backend } = state
  const sourceDirectory = resolve(ROOT, "infra/terraform")
  const moduleDirectory = sourceDirectory
  const sourceFingerprint = foundationSourceFingerprint(
    sourceDirectory,
    inputs,
    backend,
  )
  return withTerraformOperatorAuth(project, config, directory, (env) =>
    executeTerraformOperation(
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
    ),
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await Promise.resolve()
    .then(() => runTerraformInfrastructure(process.argv.slice(2)))
    .catch((error) => {
      process.exitCode = cli(() => {
        throw error
      })
    })
