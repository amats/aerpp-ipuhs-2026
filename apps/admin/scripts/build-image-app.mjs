import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, readdirSync } from "node:fs"
import { relative, resolve } from "node:path"
import { adminBuildEnvironment } from "./build-settings.mjs"

const environment = process.env.AERPP_ENVIRONMENT
if (!["test", "production"].includes(environment))
  throw new Error("Select an Admin image environment")
const result = spawnSync("pnpm", ["run", "build"], {
  stdio: "inherit",
  env: adminBuildEnvironment(environment),
})
process.exitCode = result.status ?? 1
if (result.status === 0) {
  const standalone = resolve(".next/standalone")
  const workspace = resolve("../..")
  const copyLicenses = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true })
    if (
      entries.some((entry) => entry.isFile() && entry.name === "package.json")
    ) {
      const source = resolve(workspace, relative(standalone, directory))
      if (existsSync(source)) {
        for (const entry of readdirSync(source, { withFileTypes: true }))
          if (
            entry.isFile() &&
            /^(licen[cs]e|notice|copying)([.-]|$)/i.test(entry.name)
          )
            copyFileSync(
              resolve(source, entry.name),
              resolve(directory, entry.name),
            )
      }
    }
    for (const entry of entries)
      if (entry.isDirectory()) copyLicenses(resolve(directory, entry.name))
  }
  copyLicenses(standalone)
}
