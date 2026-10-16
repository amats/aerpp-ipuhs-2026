import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readAdminDeployment } from "@aerpp/config/admin-deployment"
import { environmentDirectory } from "@aerpp/config/workspace"
import {
  cli,
  cloudEnvironment,
  gcloud,
  outputDirectory,
  privateJson,
  readJson,
} from "../shared/delivery.mjs"
import {
  retainedSecretVersions,
  selectSecretDestruction,
} from "./secret-versions.mjs"

export function addPreparedSecretPins(pins, records, project) {
  const add = (secret, version) => {
    if (!pins[secret] || !/^[1-9][0-9]*$/.test(version ?? ""))
      throw new Error("Invalid prepared secret reference")
    pins[secret].push(version)
  }
  for (const record of records.admin.filter(Boolean)) {
    const keys = Object.keys(record.versions ?? {})
    // Protect serving revisions while additional export secrets are staged.
    if (
      record.project !== project ||
      !keys.includes("NEXTAUTH_SECRET") ||
      !keys.includes("ADMIN_GOOGLE_OAUTH_CLIENT_SECRET") ||
      keys.some(
        (key) =>
          ![
            "NEXTAUTH_SECRET",
            "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
            "SESSION_SEAL_PASSWORD",
            "IDENTIFIER_HASH_SECRET",
          ].includes(key),
      )
    )
      throw new Error("Invalid Admin secret evidence")
    const references = Object.values(record.versions)
    if (references.some((reference) => typeof reference !== "string"))
      throw new Error("Invalid Admin secret reference")
    if (
      new Set(references.map((reference) => reference.split(":")[0])).size !==
      keys.length
    )
      throw new Error("Duplicate Admin secret references")
    for (const reference of references) {
      const parts = reference.split(":")
      if (parts.length !== 2 || parts[0] === "SUPPORT_RUNTIME_JSON")
        throw new Error("Invalid Admin secret reference")
      add(...parts)
    }
  }
  for (const record of records.support.filter(Boolean)) {
    if (record.project !== project)
      throw new Error("Cross-project Support secret evidence")
    add("SUPPORT_RUNTIME_JSON", record.runtimeVersion)
  }
  return Object.fromEntries(
    Object.entries(pins).map(([secret, values]) => [
      secret,
      [...new Set(values)].sort(),
    ]),
  )
}

export function executeSecretCleanup({
  project,
  environment,
  secrets,
  collectPins,
  execute = gcloud,
  save,
  apply = false,
}) {
  if (typeof apply !== "boolean")
    throw new Error("Secret cleanup apply flag must be a boolean")
  const pins = collectPins()
  const inventory = (secret) =>
    JSON.parse(
      execute(project, [
        "secrets",
        "versions",
        "list",
        secret,
        "--format=json(name,state,createTime)",
      ]),
    )
  // Validate every secret before destroying any version.
  const entries = secrets.map((secret) => {
    const versions = inventory(secret)
    return {
      secret,
      before: versions.filter((item) => item.state !== "DESTROYED").length,
      protected: pins[secret],
      candidates: selectSecretDestruction(versions, secret, pins[secret]),
      attempted: [],
      destroyed: [],
    }
  })
  const report = {
    _comment: "Generated secret retention evidence; do not edit",
    project,
    environment,
    apply,
    createdAt: new Date().toISOString(),
    secrets: entries,
  }
  save(report)
  if (apply === true)
    for (const entry of entries)
      for (const version of entry.candidates) {
        if (JSON.stringify(collectPins()) !== JSON.stringify(pins))
          throw new Error("Secret protection changed; rerun cleanup")
        if (
          !selectSecretDestruction(
            inventory(entry.secret),
            entry.secret,
            pins[entry.secret],
          ).includes(version)
        )
          throw new Error("Secret inventory changed; rerun cleanup")
        entry.attempted.push(version)
        save(report)
        execute(project, [
          "secrets",
          "versions",
          "destroy",
          version,
          `--secret=${entry.secret}`,
        ])
        if (
          !inventory(entry.secret).some(
            (item) =>
              item.name.endsWith(`/versions/${version}`) &&
              item.state === "DESTROYED",
          )
        )
          throw new Error(
            "Secret destruction not confirmed; inspect retention evidence and any destruction delay",
          )
        entry.destroyed.push(version)
        save(report)
      }
  return report
}

export function main(args = process.argv.slice(2), component = "all") {
  const [environment, ...options] = args
  cloudEnvironment(environment)
  if (!["all", "admin", "support"].includes(component))
    throw new Error("Invalid secret cleanup component")
  if (options.length > 1 || (options.length && options[0] !== "--apply"))
    throw new Error("Usage: cloud:secrets test|production [--apply]")
  const config = readJson(
    resolve(environmentDirectory(environment), "config.json"),
    "Selected environment configuration",
  )
  const project = config.projectId
  const region = config.infrastructure.region
  const admin =
    component !== "support" ? readAdminDeployment(environment) : undefined
  if (admin && admin.region !== region) throw new Error("Cloud region mismatch")
  const secrets = [
    ...(admin
      ? [
          `${admin.service}-session`,
          `${admin.service}-oauth`,
          `${admin.service}-email-seal`,
          `${admin.service}-identifier-hash`,
        ]
      : []),
    ...(component !== "admin" ? ["SUPPORT_RUNTIME_JSON"] : []),
  ]
  const output = outputDirectory(environment)
  const read = (name) =>
    existsSync(resolve(output, `${name}.json`))
      ? readJson(resolve(output, `${name}.json`), "Secret protection evidence")
      : undefined
  const projectNumber = gcloud(project, [
    "projects",
    "describe",
    project,
    "--format=value(projectNumber)",
  ])
  if (!/^[0-9]+$/.test(projectNumber))
    throw new Error("Missing project identity")
  const collectPins = () => {
    const services = JSON.parse(
      gcloud(project, [
        "run",
        "services",
        "list",
        `--region=${region}`,
        "--format=json",
      ]),
    )
    const revisions = JSON.parse(
      gcloud(project, [
        "run",
        "revisions",
        "list",
        `--region=${region}`,
        "--format=json",
      ]),
    )
    const recovery =
      component !== "admin" ? read("support-recovery-selection") : undefined
    const baseline =
      component !== "admin"
        ? read("support-mail-admission-baseline")
        : undefined
    return addPreparedSecretPins(
      retainedSecretVersions(services, revisions, secrets, [
        project,
        projectNumber,
      ]),
      {
        admin: admin ? [read("admin-prepared"), read("admin-deployed")] : [],
        support:
          component !== "admin"
            ? [
                read("support-deployment"),
                baseline?.cloud,
                ...(recovery && !recovery.restoredSelectionAt
                  ? [recovery.original, recovery.selected]
                  : []),
              ]
            : [],
      },
      project,
    )
  }
  const report = executeSecretCleanup({
    project,
    environment,
    secrets,
    collectPins,
    apply: options.includes("--apply"),
    save: (value) =>
      privateJson(resolve(output, "secret-retention.json"), value),
  })
  for (const item of report.secrets)
    console.log(
      `${environment} ${item.secret}: ${item.before} retained versions, ${item.candidates.length} old candidates, ${item.destroyed.length} destroyed`,
    )
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = cli(() => main())
