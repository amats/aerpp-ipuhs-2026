import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
export function login(
  command,
  args,
  {
    environment = process.env,
    run = spawnSync,
    exists = existsSync,
    log = console.log,
    readProfile = (name) =>
      JSON.parse(
        readFileSync(resolve(ROOT, "config", name, "config.json"), "utf8"),
      ),
  } = {},
) {
  if (command !== "gcloud") throw new Error("Select gcloud")
  const script = "auth:login"
  const help = `Usage: pnpm run ${script} test|production [--no-browser]\nOpens a browser when login is needed. Use --no-browser for remote code-entry login.`
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    log(help)
    return
  }
  const [selected, mode, ...extra] = args
  if (
    !["test", "production"].includes(selected) ||
    (mode !== undefined && mode !== "--no-browser") ||
    extra.length
  )
    throw new Error(help)
  const account = readProfile(selected).infrastructure?.operatorAccount
  if (
    typeof account !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)
  )
    throw new Error(
      "Configure the selected infrastructure.operatorAccount before login",
    )
  const noBrowser = mode === "--no-browser"
  const commandArgs = [
    "auth",
    "login",
    account,
    "--no-activate",
    noBrowser ? "--no-launch-browser" : "--launch-browser",
  ]
  const env = { ...environment }
  env.CLOUDSDK_CORE_DISABLE_PROMPTS = "0"
  if (!env.CLOUDSDK_CONFIG && exists(resolve(ROOT, "private/tools/gcloud")))
    env.CLOUDSDK_CONFIG = resolve(ROOT, "private/tools/gcloud")

  const version = run(command, ["--version"], {
    env,
    cwd: ROOT,
    stdio: "ignore",
  })
  if (version.error || version.status !== 0)
    throw new Error(
      `${command} is unavailable. Install the CLI or rebuild the Dev Container and retry.`,
    )
  const checkArgs = [
    "auth",
    "list",
    `--filter=account=${account}`,
    "--format=json",
    "--quiet",
  ]
  const check = run(command, checkArgs, {
    env,
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 30000,
  })
  if (check.error || check.status !== 0)
    throw new Error(
      `${command} login status could not be checked. No login was started.`,
    )
  let accounts
  try {
    accounts = JSON.parse(check.stdout)
    if (
      !Array.isArray(accounts) ||
      accounts.some(
        (account) =>
          typeof account?.account !== "string" ||
          !["ACTIVE", "INACTIVE", ""].includes(account.status),
      )
    )
      throw new Error()
  } catch {
    throw new Error(
      `${command} returned an unexpected login status. No login was started.`,
    )
  }
  if (accounts.some((entry) => entry.account === account)) {
    log(
      `${command}: saved login found; skipping login (credential validity not checked).`,
    )
    return
  }
  log(`${command}: no saved login found.`)
  log(
    noBrowser
      ? `Signing in to ${command}. Open the displayed URL in your browser and follow the prompts.`
      : `Signing in to ${command}. Follow the browser prompts; if it cannot open, retry with --no-browser.`,
  )
  const result = run(command, commandArgs, { env, cwd: ROOT, stdio: "inherit" })
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} login did not complete. Retry with pnpm run auth:login ${selected}.`,
    )
  log("CLI login completed.")
}
