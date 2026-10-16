import { type SpawnSyncOptions, spawnSync } from "node:child_process"
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type SpawnCapturedOptions = Omit<
  SpawnSyncOptions,
  "encoding" | "input" | "stdio"
>

export function spawnCaptured(
  command: string,
  args: readonly string[],
  options: SpawnCapturedOptions = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), "aerpp-spawn-"))
  const stdoutPath = path.join(directory, "stdout")
  const stderrPath = path.join(directory, "stderr")
  let stdoutFd: number | null = null
  let stderrFd: number | null = null

  try {
    stdoutFd = openSync(stdoutPath, "w", 0o600)
    stderrFd = openSync(stderrPath, "w", 0o600)
    const result = spawnSync(command, [...args], {
      ...options,
      stdio: ["ignore", stdoutFd, stderrFd],
    })

    closeSync(stdoutFd)
    stdoutFd = null
    closeSync(stderrFd)
    stderrFd = null

    const stdout = readFileSync(stdoutPath, "utf8")
    const stderr = readFileSync(stderrPath, "utf8")

    return {
      ...result,
      output: [null, stdout, stderr] as const,
      stdout,
      stderr,
    }
  } finally {
    if (stdoutFd !== null) {
      closeSync(stdoutFd)
    }
    if (stderrFd !== null) {
      closeSync(stderrFd)
    }
    rmSync(directory, { force: true, recursive: true })
  }
}
