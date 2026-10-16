import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { environmentTarget } from "@aerpp/config/targets"
import {
  environmentDirectory,
  initializeEnvironment,
} from "@aerpp/config/workspace"
import {
  assertProjectReady,
  enableProjectServices,
} from "../cloud/project-services.mjs"
import {
  cli,
  cloudEnvironment,
  gcloud,
  readJson,
  run,
} from "../shared/delivery.mjs"
import { assertSetupConfiguration } from "./setup/configuration.mjs"

const USAGE =
  "Usage: env:setup test|production init <project-id>, plan, apply [--replace-secrets], or check"

export function setupEnvironment(args, dependencies = {}) {
  const {
    execute = gcloud,
    runCommand = run,
    target = environmentTarget,
    directory = environmentDirectory,
    initialize = initializeEnvironment,
    report = () => {},
  } = dependencies
  const [environment, phase, ...extra] = args
  cloudEnvironment(environment)
  if (
    !["init", "plan", "apply", "check"].includes(phase) ||
    (phase === "init" && (extra.length !== 1 || extra[0].startsWith("--"))) ||
    (["plan", "check"].includes(phase) && extra.length !== 0) ||
    (phase === "apply" &&
      (extra.length > 1 ||
        (extra.length === 1 && extra[0] !== "--replace-secrets")))
  )
    throw new Error(USAGE)
  const configurationDirectory = directory(environment)
  if (phase === "init") {
    if (
      ["config.json", "secret.json"].some((name) =>
        existsSync(resolve(configurationDirectory, name)),
      )
    )
      throw new Error(
        "Private configuration inputs already exist; edit them without reinitializing",
      )
    initialize(environment, configurationDirectory, { [environment]: extra[0] })
    return { phase, manualInputsRequired: true }
  }
  const selected = target(environment)
  const config = readJson(
    resolve(configurationDirectory, "config.json"),
    "Private config",
  )
  assertSetupConfiguration(config, selected, configurationDirectory)
  const command = (name, ...commandArgs) => {
    report(`${environment}/${name}: starting`)
    const result = runCommand("pnpm", [
      "run",
      name,
      environment,
      ...commandArgs,
    ])
    report(`${environment}/${name}: complete`)
    return result
  }
  if (phase === "plan") {
    assertProjectReady(selected.project, execute)
    report(`${environment}: enabling required cloud APIs`)
    enableProjectServices(selected.project, execute)
    command("env:sync", "--refresh")
    command("infra:terraform", "bootstrap")
    command("infra:terraform", "plan")
    return { phase, reviewRequired: true }
  }
  if (phase === "check") {
    command("env:check")
    command("support:check-gmail")
    return { phase, credentialsChecked: true }
  }
  command("infra:terraform", "apply")
  command("env:sync", "--refresh")
  command(
    "env:prepare-secrets",
    "--upload",
    ...(extra.includes("--replace-secrets") ? ["--replace"] : []),
  )
  return { phase, manualCredentialsRequired: true }
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE)
    return
  }
  const result = setupEnvironment(args, {
    report: (message) => console.log(message),
  })
  if (result.phase === "init")
    console.log(
      "Private cloud placeholders created. Complete operator inputs and authenticate before env:setup plan.",
    )
  else if (result.phase === "plan")
    console.log(
      "Cloud APIs and state backend prepared. Review the private Terraform plan before env:setup apply.",
    )
  else if (result.phase === "check")
    console.log(
      "Configuration and Gmail token refresh checked. No mail sent or service deployed.",
    )
  else
    console.log(
      "Cloud foundation and application secrets prepared. Complete manual OAuth/Gmail/Logging settings before validation and delivery.",
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = cli(() => main())
