import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { applicationEnvironment } from "@aerpp/config/process"
import { generatedEnvironmentDirectory, ROOT } from "@aerpp/config/workspace"

export function cloudEnvironment(environment) {
  if (!["test", "production"].includes(environment))
    throw new Error("Select test or production explicitly")
  return environment
}
export function privateJson(file, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`
  const temp = `${file}.${randomUUID()}.tmp`
  const fd = openSync(temp, "wx", 0o600)
  try {
    try {
      writeFileSync(fd, contents)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, file)
  } finally {
    rmSync(temp, { force: true })
  }
}
export function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error(`Cannot read ${label}`)
  }
}
export function outputDirectory(environment) {
  const output = generatedEnvironmentDirectory(cloudEnvironment(environment))
  mkdirSync(output, { recursive: true, mode: 0o700 })
  return output
}
export function toolEnvironment() {
  const env = applicationEnvironment({})
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "REMOTE_CONTAINERS_IPC",
    "BUILDX_CONFIG",
    "BUILDX_BUILDER",
    "CLOUDSDK_CONFIG",
    "CLOUDSDK_AUTH_ACCESS_TOKEN_FILE",
    "CLOUDSDK_PYTHON",
  ])
    if (process.env[key]) env[key] = process.env[key]
  env.BUILDX_CONFIG ||= resolve(ROOT, "private/tools/docker/shared/buildx")
  if (!env.CLOUDSDK_CONFIG && existsSync(resolve(ROOT, "private/tools/gcloud")))
    env.CLOUDSDK_CONFIG = resolve(ROOT, "private/tools/gcloud")
  env.CLOUDSDK_CORE_DISABLE_PROMPTS = "1"
  env.CLOUDSDK_CORE_DISABLE_USAGE_REPORTING = "true"
  return env
}
export function run(
  command,
  args,
  { env = toolEnvironment(), input, log, cwd = ROOT } = {},
) {
  const fd = log ? openSync(log, "a", 0o600) : undefined
  try {
    const result = spawnSync(command, args, {
      cwd,
      env,
      input,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: log ? ["pipe", fd, fd] : "pipe",
    })
    if (result.error || result.status !== 0) {
      if (!log) {
        const directory = resolve(ROOT, "generated/reports/tooling")
        mkdirSync(directory, { recursive: true, mode: 0o700 })
        writeFileSync(
          resolve(directory, "tool-error.log"),
          result.stderr || result.error?.message || "Command failed",
          { mode: 0o600 },
        )
      }
      throw new Error(
        `${command === "docker" ? "Docker" : command.endsWith("gcloud") ? "gcloud" : "Command"} failed${log ? "; see private operation log" : "; check authentication, permissions and tool availability"}`,
      )
    }
    return result.stdout?.trim() ?? ""
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
export function cloudAccountEnvironment(
  project,
  configs,
  base = toolEnvironment(),
) {
  const selected = configs.filter((config) => config.projectId === project)
  if (selected.length !== 1)
    throw new Error(
      "Cloud operation requires one matching private project configuration",
    )
  const account = selected[0].infrastructure.operatorAccount
  if (
    typeof account !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)
  )
    throw new Error(
      "Configure the selected infrastructure.operatorAccount before cloud operations",
    )
  const env = { ...base, CLOUDSDK_CORE_ACCOUNT: account }
  env.CLOUDSDK_AUTH_ACCESS_TOKEN_FILE = ""
  env.CLOUDSDK_AUTH_ACCESS_TOKEN = ""
  env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE = ""
  env.CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT = ""
  return env
}
export function gcloud(project, args, options = {}) {
  const configs = ["test", "production"].flatMap((environment) => {
    const file = resolve(ROOT, "config", environment, "config.json")
    if (!existsSync(file)) return []
    try {
      return [readJson(file, "Private cloud configuration")]
    } catch {
      return []
    }
  })
  const env = cloudAccountEnvironment(
    project,
    configs,
    options.env ?? toolEnvironment(),
  )
  return run("gcloud", [...args, `--project=${project}`, "--quiet"], {
    ...options,
    env,
  })
}
export function cli(main) {
  try {
    return main() ?? 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}
