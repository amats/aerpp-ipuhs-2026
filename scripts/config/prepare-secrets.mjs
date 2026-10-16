import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readAutoSettings } from "@aerpp/config/auto-settings"
import { deriveInfrastructure } from "@aerpp/config/infrastructure"
import { environmentTarget } from "@aerpp/config/targets"
import { environmentDirectory, ROOT } from "@aerpp/config/workspace"
import { adminSecretNames } from "../admin/secret-names.mjs"
import { prepareSecretVersion } from "../cloud/secret-versions.mjs"
import {
  cli,
  cloudEnvironment,
  gcloud,
  outputDirectory,
  privateJson,
  readJson,
} from "../shared/delivery.mjs"

const APPLICATION_SECRET_KEYS = [
  "IDENTIFIER_HASH_SECRET",
  "SESSION_SEAL_PASSWORD",
  "NEXTAUTH_SECRET",
  "SUPPORT_TOKEN_KEY",
  "SUPPORT_WEB_API_CREDENTIAL",
]

export function prepareApplicationSecrets(
  target,
  directory,
  output,
  { replace = false, upload = false, execute = gcloud } = {},
) {
  cloudEnvironment(target.name)
  const config = readJson(resolve(directory, "config.json"), "Private config")
  if (config.projectId !== target.project)
    throw new Error("Application secret setup target mismatch")
  const file = resolve(directory, "secret.json")
  const secrets = readJson(file, "Private secret store")
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets))
    throw new Error("Invalid private secret store")
  const examples = readJson(
    resolve(ROOT, "config/example/secret.json"),
    "Public secret template",
  )
  const changed = APPLICATION_SECRET_KEYS.filter((key) => {
    const value = secrets[key]
    if (value !== undefined && typeof value !== "string")
      throw new Error(`Invalid application secret input: ${key}`)
    return (
      replace === true ||
      value === undefined ||
      value.trim().length === 0 ||
      /^(YOUR_|replace[-_ ]with)/i.test(value) ||
      value === examples[key]
    )
  })
  if (changed.length > 0 || upload === true) {
    if (
      config.support?.admissionOpen !== false ||
      config.support?.maintenanceEnabled !== false
    )
      throw new Error(
        "Initial secret setup requires closed admission and maintenance",
      )
    if (
      [
        "admin-prepared.json",
        "admin-deployed.json",
        "support-deployment.json",
        "web-image.json",
        "web-bundle.json",
      ].some((name) => existsSync(resolve(output, name)))
    )
      throw new Error(
        "Initial secret setup cannot change prepared or deployed environments",
      )
  }
  const { deployment } = deriveInfrastructure(config, target)
  if (upload === true) {
    const foundation = readAutoSettings(directory, target).terraform?.support
    if (!foundation || foundation.region !== deployment.region)
      throw new Error(
        "Apply the selected Terraform foundation before uploading secrets",
      )
  }
  if (changed.length > 0 || upload === true) {
    const services = JSON.parse(
      execute(target.project, [
        "run",
        "services",
        "list",
        `--region=${deployment.region}`,
        "--format=json(metadata.name)",
      ]),
    )
    if (
      services.some((service) =>
        [deployment.service, "aerpp-support"].includes(service.metadata?.name),
      )
    )
      throw new Error(
        "Initial secret setup requires undeployed application services",
      )
  }
  for (const key of changed) {
    const value = randomBytes(32).toString("base64url")
    secrets[key] =
      key === "SUPPORT_WEB_API_CREDENTIAL"
        ? `web-${target.name}.${value}`
        : value
  }
  if (changed.length > 0) privateJson(file, secrets)
  const versions = {}
  if (upload === true) {
    mkdirSync(output, { recursive: true, mode: 0o700 })
    const names = adminSecretNames(deployment)
    for (const key of [
      "NEXTAUTH_SECRET",
      "SESSION_SEAL_PASSWORD",
      "IDENTIFIER_HASH_SECRET",
    ])
      versions[key] = prepareSecretVersion(
        target.project,
        names[key],
        secrets[key],
        output,
        execute,
      )
  }
  return { changed, versions }
}

export function main(args = process.argv.slice(2)) {
  const [environment, ...flags] = args
  cloudEnvironment(environment)
  if (
    new Set(flags).size !== flags.length ||
    flags.some((flag) => !["--replace", "--upload"].includes(flag))
  )
    throw new Error(
      "Usage: env:prepare-secrets test|production [--replace] [--upload]",
    )
  const result = prepareApplicationSecrets(
    environmentTarget(environment),
    environmentDirectory(environment),
    outputDirectory(environment),
    {
      replace: flags.includes("--replace"),
      upload: flags.includes("--upload"),
    },
  )
  console.log(
    `Application secret inputs prepared: ${result.changed.length} updated; values not displayed`,
  )
  console.log(
    `Admin secret versions prepared: ${Object.keys(result.versions).length}; no service deployed`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = cli(() => main())
