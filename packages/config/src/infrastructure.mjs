import { storedServiceIdentity } from "./credential-files.mjs"

export function parseAdminDeployment(value) {
  const keys = [
    "version",
    "region",
    "service",
    "repository",
    "serviceAccountId",
    "maxInstances",
  ]
  if (
    value?.version !== 1 ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid Admin deployment configuration")
  for (const key of ["service", "repository", "serviceAccountId"])
    if (
      typeof value[key] !== "string" ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value[key])
    )
      throw new Error(`Invalid Admin deployment ${key}`)
  if (!/^[a-z]+-[a-z]+[0-9]$/.test(value.region ?? ""))
    throw new Error("Invalid Admin deployment region")
  if (
    !Number.isInteger(value.maxInstances) ||
    value.maxInstances < 1 ||
    value.maxInstances > 10
  )
    throw new Error("Admin maxInstances must be between 1 and 10")
  return { ...value }
}

export function deriveInfrastructure(config, target, directory) {
  const settings = config.infrastructure ?? {}
  const keys = [
    "monitoring",
    "firestore",
    "region",
    "service",
    "repository",
    "maxInstances",
    "projectId",
    "operatorAccount",
  ]
  if (Object.keys(settings).some((key) => !keys.includes(key)))
    throw new Error("Unknown infrastructure setting")
  const admin = `aerpp-admin-runtime@${target.project}.iam.gserviceaccount.com`
  const localAdmin = `aerpp-admin-local@${target.project}.iam.gserviceaccount.com`
  const logging =
    (directory && storedServiceIdentity(directory, target, "logging")) ||
    `aerpp-logging@${target.project}.iam.gserviceaccount.com`
  if (new Set([admin, localAdmin, logging]).size !== 3)
    throw new Error(
      "Admin runtime, local Admin and logging require distinct service accounts",
    )
  const deployment = parseAdminDeployment({
    version: 1,
    region: settings.region ?? "asia-northeast1",
    service: settings.service ?? "aerpp-admin",
    repository: settings.repository ?? "aerpp-admin",
    serviceAccountId: admin.split("@")[0],
    maxInstances: settings.maxInstances ?? 2,
  })
  return { deployment, serviceAccounts: { admin, localAdmin, logging } }
}
