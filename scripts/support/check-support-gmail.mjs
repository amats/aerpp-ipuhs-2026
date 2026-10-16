import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { readSupportEnvironment } from "@aerpp/config/support"
import {
  environmentDirectory,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import { outputDirectory, privateJson } from "../shared/delivery.mjs"

export async function checkGmail(args, dependencies) {
  const [environment] = args
  if (args.length !== 1 || !["test", "production"].includes(environment))
    throw new Error("Select test or production explicitly")
  const runtime = dependencies.load(environment)
  if (
    runtime.environment !== environment ||
    runtime.mailMode !== "gmail" ||
    !runtime.gmail
  )
    throw new Error("Selected Gmail configuration required")
  const evidence = {
    _comment: "Generated token health evidence; do not edit",
    checkedAt: new Date().toISOString(),
    target: environment,
    healthy: false,
    mailSent: false,
  }
  try {
    await dependencies.health(runtime.gmail)
    evidence.healthy = true
  } catch (error) {
    evidence.failureCode =
      error?.code === "MAIL_REAUTHORIZATION_REQUIRED"
        ? "MAIL_REAUTHORIZATION_REQUIRED"
        : "MAIL_TEMPORARILY_UNAVAILABLE"
  }
  dependencies.save(evidence)
  return evidence.healthy
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const healthy = await checkGmail(process.argv.slice(2), {
      load(environment) {
        const { values } = prepareApplicationRuntime(
          environment,
          environmentDirectory(environment),
          { apps: "support" },
        )
        return readSupportEnvironment(values.support)
      },
      async health(settings) {
        const { GmailMailer } = await import("../../apps/support/dist/mail.mjs")
        await new GmailMailer(settings).health()
      },
      save(evidence) {
        privateJson(
          resolve(outputDirectory(evidence.target), "gmail-token-health.json"),
          evidence,
        )
      },
    })
    if (!healthy) throw new Error()
    console.log(
      "Selected Gmail token refresh passed. No mail sent; private evidence saved.",
    )
  } catch {
    console.error(
      "Gmail health check failed. Check selected configuration and private health evidence; no secret details emitted.",
    )
    process.exitCode = 1
  }
}
