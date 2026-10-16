import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { assertAdminBuildEnvironment } from "./build-environment.mjs"

export function validateImageRuntime(env, buildId) {
  if (!["test", "production"].includes(env.AERPP_ENVIRONMENT))
    throw new Error("Admin image requires an explicit cloud environment")
  assertAdminBuildEnvironment(env.AERPP_ENVIRONMENT, buildId)
  if (env.NODE_ENV !== "production")
    throw new Error("Admin image requires production mode")
  if (
    env.ADMIN_AUTH_BYPASS_ENABLED &&
    env.ADMIN_AUTH_BYPASS_ENABLED !== "false"
  )
    throw new Error("Admin image must not bypass authentication")
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  validateImageRuntime(
    process.env,
    readFileSync(new URL("../.next/BUILD_ID", import.meta.url), "utf8").trim(),
  )
  await import("../server.js")
}
