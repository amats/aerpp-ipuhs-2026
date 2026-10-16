import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const files = readdirSync(new URL("../src/", import.meta.url))
  .filter((file) => file.endsWith(".mjs") && !file.endsWith(".test.mjs"))
  .sort()

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", `src/${file}`], {
    cwd: ROOT,
    stdio: "inherit",
  })
  if (result.error !== undefined || result.status !== 0) {
    process.exitCode = result.status ?? 1
    break
  }
}
