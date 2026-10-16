import { spawnSync } from "node:child_process"
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  rmSync,
} from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { spawnCaptured } from "./spawn-captured.mjs"

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    closeSync: vi.fn(actual.closeSync),
    mkdtempSync: vi.fn(actual.mkdtempSync),
    openSync: vi.fn(actual.openSync),
  }
})

const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs")

afterEach(() => {
  // Fence leaked fixture resources even when a cleanup regression fails the test.
  const closed = new Set(vi.mocked(closeSync).mock.calls.map(([fd]) => fd))
  for (const result of vi.mocked(openSync).mock.results) {
    if (result.type !== "return" || closed.has(result.value) === true) continue
    try {
      actualFs.closeSync(result.value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBADF") throw error
    }
  }
  for (const result of vi.mocked(mkdtempSync).mock.results) {
    if (result.type === "return")
      rmSync(result.value, { recursive: true, force: true })
  }
  vi.clearAllMocks()
})

describe("spawnCaptured", () => {
  it("captures child process output without anonymous pipes", () => {
    const result = spawnCaptured(process.execPath, [
      "-e",
      'process.stdout.write("stdout-value"); process.stderr.write("stderr-value")',
    ])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("stdout-value")
    expect(result.stderr).toBe("stderr-value")
  })

  it("preserves a non-zero child process status", () => {
    const result = spawnCaptured(process.execPath, ["-e", "process.exit(7)"])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(7)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })

  it.each(["stdout", "stderr"])(
    "removes temporary resources when opening %s fails before spawning",
    (output) => {
      if (output === "stderr")
        vi.mocked(openSync).mockImplementationOnce(actualFs.openSync)
      vi.mocked(openSync).mockImplementationOnce(() => {
        throw new Error("Synthetic output open failure")
      })

      expect(() =>
        spawnCaptured(process.execPath, ["-e", "process.exit(0)"]),
      ).toThrow("Synthetic output open failure")
      expect(spawnSync).not.toHaveBeenCalled()
      for (const result of vi.mocked(openSync).mock.results) {
        if (result.type === "return") {
          expect(() => fstatSync(result.value)).toThrow()
        }
      }
      const directory = vi.mocked(mkdtempSync).mock.results[0].value
      expect(existsSync(directory)).toBe(false)
    },
  )
})
