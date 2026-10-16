import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { validateSupportFoundation } from "./terraform.mjs"

export const AUTO_COMMENT =
  "Automatically generated. DO NOT EDIT MANUALLY. env:sync owns cloud metadata; infra:terraform owns terraform metadata. No secrets or OAuth credentials belong in this file."

export function autoSettingsFile(directory) {
  return resolve(directory, "../../generated", basename(directory), "auto.json")
}

export function readAutoSettings(directory, target) {
  const file = autoSettingsFile(directory)
  if (existsSync(resolve(directory, "auto.json")))
    throw new Error(
      "Unexpected config auto.json; automatic metadata belongs under generated",
    )
  if (!existsSync(file))
    return {
      version: 1,
      _comment: AUTO_COMMENT,
      environment: target.name,
      project: target.project,
    }
  let data
  try {
    data = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error("Cannot read auto.json")
  }
  return validateAutoSettings(data, target)
}

export function validateAutoSettings(data, target) {
  if (
    data?.version !== 1 ||
    data.environment !== target.name ||
    data.project !== target.project
  )
    throw new Error("auto.json environment or project mismatch")
  const keys = [
    "version",
    "_comment",
    "environment",
    "project",
    "projectNumber",
    "updatedAt",
    "deployment",
    "serviceAccounts",
    "adminUrl",
    "cloudStatus",
    "terraform",
  ]
  if (Object.keys(data).some((key) => !keys.includes(key)))
    throw new Error("Unexpected auto.json field")
  if (data.terraform !== undefined) {
    if (!data.terraform || Object.keys(data.terraform).join(",") !== "support")
      throw new Error("Unexpected Terraform metadata owner")
    validateSupportFoundation(data.terraform.support, target)
  }
  if (
    data.deployment &&
    Object.keys(data.deployment).some(
      (key) =>
        ![
          "version",
          "region",
          "service",
          "repository",
          "serviceAccountId",
          "maxInstances",
        ].includes(key),
    )
  )
    throw new Error("Unexpected automatic deployment field")
  if (data.serviceAccounts)
    for (const [key, value] of Object.entries(data.serviceAccounts)) {
      if (
        !["admin", "localAdmin", "logging"].includes(key) ||
        typeof value !== "string" ||
        !value.endsWith(`@${target.project}.iam.gserviceaccount.com`)
      )
        throw new Error("Automatic service-account target mismatch")
    }
  if (data.adminUrl) {
    const url = new URL(data.adminUrl)
    if (url.protocol !== "https:" || url.origin !== data.adminUrl)
      throw new Error("Invalid generated Admin URL")
  }
  return data
}

export function writeAutoSettings(directory, target, patch) {
  if (Object.hasOwn(patch, "terraform"))
    throw new Error("Terraform metadata must be written by infra:terraform")
  return writeSettings(directory, target, patch)
}

export function writeSupportTerraformSettings(directory, target, foundation) {
  const support = validateSupportFoundation(foundation, target)
  return writeSettings(directory, target, { terraform: { support } })
}

function writeSettings(directory, target, patch) {
  const data = {
    ...readAutoSettings(directory, target),
    ...patch,
    _comment: AUTO_COMMENT,
    version: 1,
    environment: target.name,
    project: target.project,
    updatedAt: new Date().toISOString(),
  }
  validateAutoSettings(data, target)
  const file = autoSettingsFile(directory)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  })
  renameSync(temporary, file)
  return data
}
