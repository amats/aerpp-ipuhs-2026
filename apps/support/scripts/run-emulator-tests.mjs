import { spawn } from "node:child_process"
import { closeSync, existsSync, mkdtempSync, openSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import { assertEmulatorJar } from "../../../scripts/support/install-support-emulator.mjs"

const ROOT = fileURLToPath(new URL("../../..", import.meta.url))
const APP = resolve(ROOT, "apps/support")

function startProcess(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
  })
  const closed = new Promise((accept) => {
    let failed = false
    child.once("error", () => {
      failed = true
    })
    // Failed spawns emit close without exit; pipes may also outlive exit.
    child.once("close", (code) => accept(failed === true ? 1 : (code ?? 1)))
  })
  return { child, closed }
}

function signalProcess(child, signal) {
  if (child.pid === undefined) return
  try {
    if (process.platform === "win32") child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}

async function stopProcess(managed) {
  if (managed === undefined) return
  const { child, closed } = managed
  signalProcess(child, "SIGTERM")
  const timer = setTimeout(() => signalProcess(child, "SIGKILL"), 5_000)
  try {
    await closed
  } finally {
    clearTimeout(timer)
    // pnpm and browser workers must not survive their process-group leader.
    signalProcess(child, "SIGKILL")
  }
}

async function unusedPort() {
  return await new Promise((accept, reject) => {
    const socket = createServer()
    socket.once("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port
      socket.close((error) => (error ? reject(error) : accept(port)))
    })
  })
}

async function waitForEmulator(port, signal) {
  for (let attempt = 0; attempt < 100; attempt++) {
    signal.throwIfAborted()
    try {
      await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
      })
      return
    } catch {
      signal.throwIfAborted()
    }
    await delay(100, undefined, { signal }).catch((error) => {
      signal.throwIfAborted()
      throw error
    })
  }
  throw new Error("Firestore emulator did not become ready")
}

export async function main(args = process.argv.slice(2)) {
  const jar =
    process.env.FIRESTORE_EMULATOR_JAR ||
    resolve(
      ROOT,
      "private/tools/firestore/cloud-firestore-emulator-v1.22.0.jar",
    )
  if (existsSync(jar) !== true)
    throw new Error(
      "Install the pinned standalone Firestore emulator; see apps/support/README.md",
    )
  assertEmulatorJar(jar)
  const port = await unusedPort()
  const env = applicationEnvironment({
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`,
  })
  env.METADATA_SERVER_DETECTION = "none"
  const controller = new AbortController()
  const cancel = (message) => controller.abort(new Error(message))
  const interrupt = () => cancel("Emulator tests interrupted")
  const terminate = () => cancel("Emulator tests terminated")
  const cancelled = new Promise((accept) =>
    controller.signal.addEventListener("abort", accept, { once: true }),
  )
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-support-e2e-"))
  let descriptor
  let emulator
  let tests
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", terminate)
  try {
    descriptor = openSync(resolve(directory, "firestore.log"), "w", 0o600)
    emulator = startProcess(
      "java",
      [
        "-jar",
        jar,
        "--host=127.0.0.1",
        `--port=${port}`,
        "--project_id=demo-support-e2e",
        `--rules=${resolve(APP, "test-support/firestore.rules")}`,
      ],
      { env, stdio: ["ignore", descriptor, descriptor] },
    )
    emulator.child.once("error", () => cancel("Could not start Java emulator"))
    void emulator.closed.then(() => cancel("Firestore emulator exited"))
    await waitForEmulator(port, controller.signal)
    controller.signal.throwIfAborted()
    tests = startProcess("pnpm", ["exec", "playwright", "test", ...args], {
      cwd: APP,
      env,
      stdio: "inherit",
    })
    const status = await Promise.race([tests.closed, cancelled])
    controller.signal.throwIfAborted()
    return status
  } finally {
    try {
      await stopProcess(tests)
    } finally {
      try {
        await stopProcess(emulator)
      } finally {
        if (descriptor !== undefined) closeSync(descriptor)
        rmSync(directory, { recursive: true, force: true })
        process.removeListener("SIGINT", interrupt)
        process.removeListener("SIGTERM", terminate)
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Emulator tests failed",
    )
    process.exitCode = 1
  }
}
