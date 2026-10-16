import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { adminServiceUrl } from "@aerpp/config/admin-deployment"
import {
  readAutoSettings,
  writeAutoSettings,
} from "@aerpp/config/auto-settings"
import { deriveInfrastructure } from "@aerpp/config/infrastructure"
import { decodeManualConfig } from "@aerpp/config/manual-config"
import { environmentTarget } from "@aerpp/config/targets"
import { environmentDirectory } from "@aerpp/config/workspace"
import { assertServiceOwnership } from "../admin/service-ownership.mjs"
import { cloudEnvironment, gcloud, readJson } from "../shared/delivery.mjs"
import { writeConsoleSettings } from "./console-settings.mjs"

export { deriveInfrastructure } from "@aerpp/config/infrastructure"

export async function main(args = process.argv.slice(2)) {
  const [environment, mode = "--refresh", ...extra] = args
  cloudEnvironment(environment)
  if (extra.length || !["--refresh", "--offline"].includes(mode))
    throw new Error("Usage: env:sync test|production [--refresh|--offline]")
  const directory = environmentDirectory(environment)
  const config = decodeManualConfig(
    readJson(resolve(directory, "config.json"), "manual config"),
  )
  const target = environmentTarget(environment)
  const previous = readAutoSettings(directory, target)
  const derived = deriveInfrastructure(config, target, directory)
  if (mode === "--offline") {
    const identityChanged =
      JSON.stringify(previous.deployment) !== JSON.stringify(derived.deployment)
    const data = writeAutoSettings(directory, target, {
      ...derived,
      ...(previous.projectNumber
        ? {
            adminUrl: adminServiceUrl(
              derived.deployment,
              previous.projectNumber,
            ),
          }
        : identityChanged
          ? { adminUrl: undefined }
          : {}),
      cloudStatus: {
        verified: false,
        note: "Offline derivation only; run --refresh",
      },
    })
    writeConsoleSettings(directory, config, data)
    console.log(
      `${environment}: local automatic settings and Console registration values generated; no cloud changes`,
    )
    return
  }
  const number = gcloud(target.project, [
    "projects",
    "describe",
    target.project,
    "--format=value(projectNumber)",
  ])
  const services = JSON.parse(
    gcloud(target.project, [
      "run",
      "services",
      "list",
      `--region=${derived.deployment.region}`,
      "--format=json(metadata.name,metadata.labels,spec.template.metadata.labels,status.url,status.conditions)",
    ]),
  )
  const service = services.find(
    (item) => item.metadata?.name === derived.deployment.service,
  )
  if (service) assertServiceOwnership(service, environment)
  const data = writeAutoSettings(directory, target, {
    ...derived,
    projectNumber: number,
    adminUrl: adminServiceUrl(derived.deployment, number),
    cloudStatus: {
      verified: true,
      discoveredAt: new Date().toISOString(),
      serviceExists: Boolean(service),
    },
  })
  writeConsoleSettings(directory, config, data)
  console.log(
    `${environment}: selected backend metadata and Console registration values updated; no cloud changes`,
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
