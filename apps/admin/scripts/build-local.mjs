import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { assertNoAppEnvFiles } from "@aerpp/config/process"
import { adminBuildEnvironment } from "./build-settings.mjs"

const directory = fileURLToPath(new URL("..", import.meta.url))
assertNoAppEnvFiles(directory)
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    "build",
  ],
  {
    cwd: directory,
    env: adminBuildEnvironment("local"),
    stdio: "inherit",
  },
)
if (result.error) console.error("Cannot start the local Admin build")
process.exitCode = result.status ?? 1
