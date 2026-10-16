import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, expect, it } from "vitest"
import { spawnCaptured } from "../spawn-captured.mjs"

const SCRIPT = path.resolve(import.meta.dirname, "start-server.mjs")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function runDebugServer(mode: number | "missing" | "interrupt") {
  const directory = mkdtempSync(path.join(tmpdir(), "aerpp-web-runner-test-"))
  directories.push(directory)
  const receipt = path.join(directory, "staging.json")
  const childReceipt = path.join(directory, "child.json")
  // Replace staging inputs and the server command; retain real child exits and CLI cleanup.
  const fileSystem = `
    import * as fs from "node:fs/promises"
    export const { mkdir, readFile, rm, symlink, writeFile } = fs
    export async function mkdtemp() {
      const directory = await fs.mkdtemp(${JSON.stringify(path.join(directory, "app-"))})
      await fs.writeFile(${JSON.stringify(receipt)}, JSON.stringify(directory))
      return directory
    }
    export async function cp(source, destination) {
      await fs.mkdir(destination, { recursive: true })
      if (source.endsWith("config/common/llm"))
        await fs.writeFile(destination + "/lms-medgemma.json", JSON.stringify({ model: "synthetic" }))
    }
  `
  const processes = `
    import { spawn as realSpawn } from "node:child_process"
    import { writeFileSync } from "node:fs"
    export function spawn(command, args, options) {
      writeFileSync(${JSON.stringify(childReceipt)}, JSON.stringify({ args, cwd: options.cwd }))
      const mode = ${JSON.stringify(mode)}
      const child = realSpawn(
        mode === "missing" ? ${JSON.stringify(path.join(directory, "missing-node"))} : process.execPath,
        ["-e", mode === "interrupt" ? "setInterval(() => {}, 1000)" : "process.exit(" + mode + ")"],
        options,
      )
      if (mode === "interrupt")
        child.once("spawn", () => setTimeout(() => process.emit("SIGTERM"), 100))
      return child
    }
  `
  const modules = {
    "node:fs/promises": fileSystem,
    "node:child_process": processes,
    "./stub-server.mjs": `export async function startStubServer() {
      return { closeAllConnections() {}, close(callback) { callback() } }
    }`,
    "../../../../scripts/licenses/stage-license-notices.mjs":
      "export function stageLicenseNotices() {}",
  }
  const loader = `
    import { registerHooks } from "node:module"
    const modules = ${JSON.stringify(modules)}
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (context.parentURL === ${JSON.stringify(pathToFileURL(SCRIPT).href)} && Object.hasOwn(modules, specifier))
        return { url: "data:text/javascript," + encodeURIComponent(modules[specifier]), shortCircuit: true }
      return nextResolve(specifier, context)
    } })
  `
  const result = spawnCaptured(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(loader)}`,
      SCRIPT,
      "--debug",
    ],
    { timeout: 8_000, killSignal: "SIGKILL" },
  )
  expect(result.error).toBeUndefined()
  const staging = JSON.parse(readFileSync(receipt, "utf8"))
  expect(existsSync(staging)).toBe(false)
  const child = JSON.parse(readFileSync(childReceipt, "utf8"))
  expect(child.args).toContain("dev")
  expect(child.cwd).toBe(path.join(staging, "apps/web"))
  return result
}

it.each([0, 7])(
  "fails when the debug server unexpectedly exits with %s",
  (code) => {
    const result = runDebugServer(code)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`exit code: ${code}`)
  },
)

it("cleans up and fails when the debug server cannot spawn", () => {
  const result = runDebugServer("missing")
  expect(result.status).toBe(1)
  expect(result.stderr).toContain("ENOENT")
})

it("treats an explicit debug server shutdown as successful cleanup", () => {
  const result = runDebugServer("interrupt")
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
})
