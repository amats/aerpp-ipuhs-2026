import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { environmentTarget } from "@aerpp/config/targets"
import {
  cli,
  gcloud,
  outputDirectory,
  privateJson,
} from "../shared/delivery.mjs"

export function inventoryQueries(region) {
  if (!/^[a-z]+-[a-z]+[0-9]+$/.test(region))
    throw new Error("Invalid inventory region")
  return [
    [
      "databases",
      [
        "firestore",
        "databases",
        "list",
        "--format=json(name,locationId,type,deleteProtectionState,pointInTimeRecoveryEnablement,earliestVersionTime)",
      ],
    ],
    [
      "services",
      [
        "run",
        "services",
        "list",
        `--region=${region}`,
        "--format=json(metadata.name,metadata.labels,spec.template.spec.serviceAccountName,spec.template.spec.containers.image,status.url,status.traffic,status.latestReadyRevisionName,status.latestCreatedRevisionName)",
      ],
    ],
    [
      "scheduler",
      [
        "scheduler",
        "jobs",
        "list",
        `--location=${region}`,
        "--format=json(name,state,schedule,timeZone,httpTarget.uri,httpTarget.oidcToken,retryConfig)",
      ],
    ],
    [
      "identities",
      ["iam", "service-accounts", "list", "--format=json(name,email,disabled)"],
    ],
    [
      "iam",
      ["projects", "get-iam-policy", "--format=json(bindings,etag,version)"],
    ],
    ["secrets", ["secrets", "list", "--format=json(name,replication,labels)"]],
    [
      "repositories",
      [
        "artifacts",
        "repositories",
        "list",
        `--location=${region}`,
        "--format=json(name,format,mode)",
      ],
    ],
    ["apis", ["services", "list", "--enabled", "--format=json(config.name)"]],
  ]
}

export function inventoryGoogleCloud(args, dependencies = {}) {
  const {
    execute = gcloud,
    target = environmentTarget,
    output = outputDirectory,
  } = dependencies
  if (args.length !== 2 || !["test", "production"].includes(args[0]))
    throw new Error("Usage: cloud:inventory test|production <region>")
  const queries = inventoryQueries(args[1])
  const { project } = target(args[0])
  const directory = resolve(
    output(args[0]),
    "cloud-inventory",
    new Date().toISOString().replaceAll(":", "-"),
  )
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const report = {
    _comment:
      "Generated read-only inventory; do not edit. Private infrastructure metadata only.",
    environment: args[0],
    project,
    region: args[1],
    createdAt: new Date().toISOString(),
    checks: {},
    complete: false,
  }
  const results = {}
  function collect(name, command) {
    try {
      const value = JSON.parse(execute(project, command))
      privateJson(resolve(directory, `${name}.json`), value)
      results[name] = value
      report.checks[name] = {
        ok: true,
        count: Array.isArray(value) ? value.length : undefined,
      }
    } catch {
      report.checks[name] = { ok: false }
    }
    privateJson(resolve(directory, "summary.json"), report)
  }
  for (const [name, command] of queries) {
    collect(
      name,
      name === "iam"
        ? [...command.slice(0, 2), project, ...command.slice(2)]
        : command,
    )
  }
  for (const [index, database] of (results.databases ?? []).entries()) {
    const id = database.name.split("/").at(-1)
    for (const [kind, command] of [
      ["indexes", ["firestore", "indexes", "composite", "list"]],
      ["ttls", ["firestore", "fields", "ttls", "list"]],
      ["backup-schedules", ["firestore", "backups", "schedules", "list"]],
    ])
      collect(`database-${index}-${kind}`, [
        ...command,
        `--database=${id}`,
        "--format=json",
      ])
  }
  report.complete = Object.values(report.checks).every((check) => check.ok)
  privateJson(resolve(directory, "summary.json"), report)
  return { directory, checks: report.checks, complete: report.complete }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = cli(() => {
    const result = inventoryGoogleCloud(process.argv.slice(2))
    for (const [name, check] of Object.entries(result.checks))
      console.log(`${name}: ${check.ok ? "recorded" : "FAILED"}`)
    console.log(
      "Private inventory saved under the selected generated cloud-inventory directory",
    )
    return result.complete ? 0 : 1
  })
}
