import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  applicationEnvironment,
  assertNoAppEnvFiles,
} from "@aerpp/config/process"
import {
  checkApplication,
  environmentDirectory,
  prepareApplicationRuntime,
  ROOT,
  validateTargetValues,
} from "@aerpp/config/workspace"
import { stageLicenseNotices } from "../licenses/stage-license-notices.mjs"
import { toolEnvironment } from "../shared/delivery.mjs"

export async function main(args = process.argv.slice(2)) {
  try {
    const [environment, app, operation, ...extra] = args
    const supported = app === "support" ? ["start"] : ["dev", "build", "start"]
    if (
      !["web", "admin", "support"].includes(app) ||
      !supported.includes(operation)
    )
      throw new Error(
        "Usage: env:run example|test|production web|admin dev|build|start, example support start",
      )
    if (environment === "production" && operation === "dev")
      throw new Error("Use the test environment for development")
    if (app === "support" && (environment !== "example" || extra.length))
      throw new Error(
        "Managed support start is local only: env:run example support start",
      )
    assertNoAppEnvFiles(resolve(ROOT, `apps/${app}`))
    const directory = environmentDirectory(environment)
    const { target, values } = prepareApplicationRuntime(
      environment,
      directory,
      { apps: app },
    )
    const settings = values[app]
    if (app === "admin" && environment === "test")
      settings.NEXTAUTH_URL = "http://localhost:3001"
    validateTargetValues(target, values)
    checkApplication(app, settings, environment)
    if (app !== "support" && operation !== "start")
      stageLicenseNotices(ROOT, app)
    if (app === "admin" && operation !== "build") {
      const account = JSON.parse(
        readFileSync(resolve(directory, "config.json")),
      ).infrastructure?.operatorAccount
      if (
        typeof account !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)
      )
        throw new Error(
          "Configure the selected operatorAccount before local Admin startup",
        )
      settings.ADMIN_GCLOUD_ACCOUNT = account
      settings.ADMIN_LOCAL_SERVICE_ACCOUNT = `aerpp-admin-local@${target.project}.iam.gserviceaccount.com`
      const configDirectory = toolEnvironment().CLOUDSDK_CONFIG
      if (configDirectory) settings.ADMIN_GCLOUD_CONFIG = configDirectory
    }
    const env = applicationEnvironment(settings)
    if (app === "support")
      env.PORT =
        new URL(JSON.parse(settings.SUPPORT_RUNTIME_JSON).baseUrl).port || "80"
    env.NODE_ENV = operation === "dev" ? "development" : "production"
    const commandArgs =
      app === "support"
        ? [resolve(ROOT, "apps/support/dist/server.mjs")]
        : [
            resolve(ROOT, `apps/${app}/node_modules/next/dist/bin/next`),
            operation,
            ...(operation === "build"
              ? []
              : ["--port", app === "web" ? "3000" : "3001"]),
            ...extra,
          ]
    console.log(
      `Starting ${environment}/${app}/${operation} from shared configuration`,
    )
    return await new Promise((accept) => {
      const child = spawn(process.execPath, commandArgs, {
        cwd: resolve(ROOT, `apps/${app}`),
        env,
        stdio: "inherit",
      })
      const stop = (signal) => child.kill(signal)
      const interrupt = () => stop("SIGINT")
      const terminate = () => stop("SIGTERM")
      process.on("SIGINT", interrupt)
      process.on("SIGTERM", terminate)
      const finish = (code) => {
        process.removeListener("SIGINT", interrupt)
        process.removeListener("SIGTERM", terminate)
        accept(code ?? 1)
      }
      child.once("error", () => {
        console.error("Cannot start selected application")
        finish(1)
      })
      child.once("exit", finish)
    })
  } catch (error) {
    console.error(error.message)
    return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main()
