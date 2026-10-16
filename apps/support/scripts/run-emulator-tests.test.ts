import { spawn } from "node:child_process"
import {
  existsSync,
  fstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { assertEmulatorJar } from "../../../scripts/support/install-support-emulator.mjs"
import { main } from "./run-emulator-tests.mjs"

vi.mock("node:child_process", () => ({ spawn: vi.fn() }))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, mkdtempSync: vi.fn(actual.mkdtempSync) }
})
vi.mock("../../../scripts/support/install-support-emulator.mjs", () => ({
  assertEmulatorJar: vi.fn(),
}))

const { spawn: realSpawn } =
  await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  )
const EMULATOR = `
  const http = require("node:http")
  const port = Number(process.argv.find(arg => arg.startsWith("--port=")).slice(7))
  http.createServer((_, response) => response.end("ready")).listen(port, "127.0.0.1")
`

let directory: string
let children: ReturnType<typeof spawn>[]
let signals: number[]

function processes(emulator = EMULATOR, tests = "process.exit(0)") {
  vi.mocked(spawn).mockImplementation((command, args, options) => {
    const child = realSpawn(
      process.execPath,
      ["-e", command === "java" ? emulator : tests, "--", ...args],
      options,
    )
    children.push(child)
    return child
  })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "aerpp-emulator-runner-test-"))
  const jar = join(directory, "synthetic.jar")
  writeFileSync(jar, "synthetic emulator fixture")
  vi.stubEnv("FIRESTORE_EMULATOR_JAR", jar)
  children = []
  signals = ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal))
  processes()
})

afterEach(() => {
  // Also fence a broken runner so a regression cannot leave fixture children running.
  for (const child of children) {
    if (child.pid !== undefined) {
      try {
        if (process.platform === "win32") child.kill("SIGKILL")
        else process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
    }
  }
  rmSync(directory, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

function expectCleanedUp() {
  const options = vi.mocked(spawn).mock.calls[0][2]
  if (Array.isArray(options.stdio) !== true)
    throw new Error("Emulator must write to its temporary log descriptor")
  const descriptor = options.stdio[1]
  if (typeof descriptor !== "number")
    throw new Error("Emulator log descriptor must be a file descriptor")
  expect(() => fstatSync(descriptor)).toThrow()
  const created = vi
    .mocked(mkdtempSync)
    .mock.results.map((result) => result.value as string)
  const staging = created.find(
    (file) => dirname(file) === tmpdir() && file.includes("aerpp-support-e2e-"),
  )
  expect(staging).toBeDefined()
  if (staging === undefined) throw new Error("Runner did not create staging")
  expect(existsSync(staging)).toBe(false)
  expect(
    ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
  ).toEqual(signals)
  for (const child of children) {
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  }
}

describe("isolated emulator runner", () => {
  it.each([0, 23])(
    "returns the test exit code %s and removes its temporary resources",
    async (code) => {
      processes(EMULATOR, `process.exit(${code})`)
      expect(
        await main(["e2e/participation.spec.ts", "--grep", "synthetic"]),
      ).toBe(code)
      expect(vi.mocked(spawn).mock.calls[1][1]).toEqual([
        "exec",
        "playwright",
        "test",
        "e2e/participation.spec.ts",
        "--grep",
        "synthetic",
      ])
      expectCleanedUp()
    },
  )

  it("rejects an invalid JAR before creating child processes", async () => {
    const actual = await vi.importActual<
      typeof import("../../../scripts/support/install-support-emulator.mjs")
    >("../../../scripts/support/install-support-emulator.mjs")
    vi.mocked(assertEmulatorJar).mockImplementationOnce(
      actual.assertEmulatorJar,
    )
    await expect(main([])).rejects.toThrow("checksum mismatch")
    expect(spawn).not.toHaveBeenCalled()
  })

  it("finishes cleanup when Java cannot spawn and emits no exit event", async () => {
    vi.mocked(spawn).mockImplementationOnce((_, args, options) => {
      const child = realSpawn(join(directory, "missing-java"), args, options)
      children.push(child)
      return child
    })
    await expect(main([])).rejects.toThrow("Could not start Java emulator")
    expect(spawn).toHaveBeenCalledTimes(1)
    expectCleanedUp()
  })

  it("fails before testing when the emulator exits during startup", async () => {
    processes("process.exit(7)")
    await expect(main([])).rejects.toThrow("Firestore emulator exited")
    expect(spawn).toHaveBeenCalledTimes(1)
    expectCleanedUp()
  })

  it("returns failure when the test command cannot spawn", async () => {
    vi.mocked(spawn)
      .mockImplementationOnce((_, args, options) => {
        const child = realSpawn(
          process.execPath,
          ["-e", EMULATOR, "--", ...args],
          options,
        )
        children.push(child)
        return child
      })
      .mockImplementationOnce((_, args, options) => {
        const child = realSpawn(join(directory, "missing-pnpm"), args, options)
        children.push(child)
        return child
      })
    expect(await main([])).toBe(1)
    expectCleanedUp()
  })

  it("stops running tests when the emulator exits after readiness", async () => {
    processes(EMULATOR, "setInterval(() => {}, 1000)")
    const running = main([])
    const rejected = expect(running).rejects.toThrow(
      "Firestore emulator exited",
    )
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
    children[0].kill("SIGTERM")
    await rejected
    expectCleanedUp()
  })

  it.each(["SIGINT", "SIGTERM"] as const)(
    "stops both children on %s",
    async (signal) => {
      processes(EMULATOR, "setInterval(() => {}, 1000)")
      const running = main([])
      const rejected = expect(running).rejects.toThrow(/interrupted|terminated/)
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2))
      process.emit(signal)
      await rejected
      expectCleanedUp()
    },
  )

  it("interrupts startup before launching tests", async () => {
    processes("setInterval(() => {}, 1000)")
    const running = main([])
    const rejected = expect(running).rejects.toThrow(/interrupted|aborted/)
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    process.emit("SIGINT")
    await rejected
    expect(spawn).toHaveBeenCalledTimes(1)
    expectCleanedUp()
  })

  it.skipIf(process.platform === "win32")(
    "stops a worker that survives its test-command parent",
    async () => {
      const marker = join(directory, "worker-port.json")
      const worker = `
        const http = require("node:http")
        const fs = require("node:fs")
        process.on("SIGTERM", () => {})
        const server = http.createServer((_, response) => response.end("worker"))
        server.listen(0, "127.0.0.1", () => {
          fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify(server.address().port))
        })
      `
      processes(
        EMULATOR,
        `
        const { spawn } = require("node:child_process")
        spawn(process.execPath, ["-e", ${JSON.stringify(worker)}], { stdio: "inherit" })
        process.on("SIGTERM", () => process.exit(0))
      `,
      )
      const running = main([])
      const rejected = expect(running).rejects.toThrow("terminated")
      await vi.waitFor(() => expect(existsSync(marker)).toBe(true))
      const port = JSON.parse(readFileSync(marker, "utf8"))
      const url = `http://127.0.0.1:${port}`
      const response = await fetch(url)
      expect(await response.text()).toBe("worker")
      process.emit("SIGTERM")
      await rejected
      await expect(
        fetch(url, { signal: AbortSignal.timeout(500) }),
      ).rejects.toThrow()
      expectCleanedUp()
    },
  )

  it("kills an emulator that ignores graceful shutdown", async () => {
    processes(`process.on("SIGTERM", () => {}); ${EMULATOR}`)
    expect(await main([])).toBe(0)
    expect(children[0].signalCode).toBe("SIGKILL")
    expectCleanedUp()
  }, 10_000)

  it("excludes inherited credentials and Node options in both real subprocesses", async () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/synthetic/credential.json")
    vi.stubEnv("CLOUDSDK_AUTH_ACCESS_TOKEN", "synthetic-token")
    vi.stubEnv("NODE_OPTIONS", "--require=/synthetic/unexpected-module.cjs")
    const assertIsolated = `
      const assert = require("node:assert/strict")
      assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, "")
      assert.equal(process.env.CLOUDSDK_AUTH_ACCESS_TOKEN, undefined)
      assert.equal(process.env.NODE_OPTIONS, "")
      assert.match(process.env.FIRESTORE_EMULATOR_HOST, /^127\\.0\\.0\\.1:[0-9]+$/)
      assert.equal(process.env.METADATA_SERVER_DETECTION, "none")
    `
    processes(`${assertIsolated}; ${EMULATOR}`, assertIsolated)
    expect(await main([])).toBe(0)
    expectCleanedUp()
  })
})
