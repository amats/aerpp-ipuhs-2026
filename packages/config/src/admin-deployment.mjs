import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { readAutoSettings } from "./auto-settings.mjs"
import {
  deriveInfrastructure,
  parseAdminDeployment,
} from "./infrastructure.mjs"
import { environmentTarget } from "./targets.mjs"
import { checkApplication, environmentDirectory } from "./workspace.mjs"

export function readAdminDeployment(
  environment,
  directory = environmentDirectory(environment),
) {
  const target = environmentTarget(environment)
  const value = readAutoSettings(directory, target).deployment
  const config = JSON.parse(
    readFileSync(resolve(directory, "config.json"), "utf8"),
  )
  const expected = deriveInfrastructure(config, target, directory).deployment
  if (
    value &&
    Object.keys(expected).some((key) => value[key] !== expected[key])
  )
    throw new Error("Deployment inputs changed; run env:sync before deployment")
  if (!value)
    throw new Error(
      "Run env:sync to generate Admin deployment settings in auto.json",
    )
  return parseAdminDeployment(value)
}

export function adminServiceUrl(deployment, projectNumber) {
  parseAdminDeployment(deployment)
  if (!/^[0-9]{6,20}$/.test(String(projectNumber)))
    throw new Error("Invalid Cloud Run project number")
  return `https://${deployment.service}-${projectNumber}.${deployment.region}.run.app`
}

export function hostedAdminEnvironment(settings, url, environment) {
  if (!["test", "production"].includes(environment))
    throw new Error("Admin deployment requires a cloud environment")
  if (settings.AERPP_ENVIRONMENT !== environment)
    throw new Error("Admin deployment profile mismatch")
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Invalid Admin hosted URL")
  }
  if (parsed.protocol !== "https:" || parsed.origin !== url)
    throw new Error("Admin hosted URL must be an HTTPS origin")
  const runtime = { ...settings, NEXTAUTH_URL: url }
  for (const key of [
    "ADMIN_GCLOUD_ACCOUNT",
    "ADMIN_LOCAL_SERVICE_ACCOUNT",
    "ADMIN_GCLOUD_CONFIG",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCP_SERVICE_ACCOUNT_EMAIL",
    "GCP_SERVICE_ACCOUNT_PRIVATE_KEY",
  ])
    delete runtime[key]
  checkApplication("admin", runtime, environment)
  const secrets = {}
  for (const key of [
    "NEXTAUTH_SECRET",
    "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
    "SESSION_SEAL_PASSWORD",
    "IDENTIFIER_HASH_SECRET",
  ]) {
    secrets[key] = runtime[key]
    delete runtime[key]
  }
  return { runtime, secrets }
}
