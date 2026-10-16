import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assertResearchAssets, REQUIRED_ASSETS } from "./image-inputs.mjs"

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url))
assertResearchAssets(path.join(workspaceRoot, "assets-public"))
const assets = await Promise.all(
  REQUIRED_ASSETS.map(async (name) => {
    const source = path.join(workspaceRoot, "assets-public", name)
    if (!(await lstat(source)).isFile())
      throw new Error(`Missing regular asset file: ${name}`)
    const bytes = await readFile(source)
    if (!bytes.length) throw new Error(`Empty asset file: ${name}`)
    return { name, sha256: createHash("sha256").update(bytes).digest("hex") }
  }),
)
const outputRoot = path.join(workspaceRoot, ".playwright/screenshots")
await mkdir(outputRoot, { recursive: true })
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
const outputDirectory = await mkdtemp(path.join(outputRoot, `${timestamp}-`))
await writeFile(
  path.join(outputDirectory, "assets.json"),
  JSON.stringify({ source: "assets-public", assets }, null, 2),
)
console.log(`Screenshot output: ${outputDirectory}`)
const child = spawn(
  process.execPath,
  [
    path.join(workspaceRoot, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    "playwright.screenshots.config.ts",
  ],
  {
    cwd: workspaceRoot,
    env: { ...process.env, AERPP_SCREENSHOT_DIR: outputDirectory },
    stdio: "inherit",
  },
)
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal))
}
try {
  const [code, signal] = await once(child, "exit")
  process.exitCode = code ?? 1
  if (code === 0) console.log(`Screenshot index: ${outputDirectory}/index.html`)
  else
    console.error(
      `Screenshot capture failed (${signal ?? code}). Output is incomplete.`,
    )
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
