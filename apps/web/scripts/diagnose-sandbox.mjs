import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import { spawnCaptured } from "../test-support/spawn-captured.mts"

const CHILD_OUTPUT = "sandbox-child-ok"

function summarizeResult(result, stdout, stderr) {
  return {
    ok:
      result.error === undefined &&
      result.status === 0 &&
      stdout === CHILD_OUTPUT,
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    errorCode: result.error?.code ?? null,
    errorMessage: result.error?.message ?? null,
  }
}

function runPipedCaptureProbe() {
  const result = spawnSync(
    process.execPath,
    ["-e", `process.stdout.write(${JSON.stringify(CHILD_OUTPUT)})`],
    { encoding: "utf8" },
  )

  return summarizeResult(result, result.stdout ?? "", result.stderr ?? "")
}

function runFileCaptureProbe() {
  const result = spawnCaptured(process.execPath, [
    "-e",
    `process.stdout.write(${JSON.stringify(CHILD_OUTPUT)})`,
  ])
  return summarizeResult(result, result.stdout, result.stderr)
}

function readIsolationStatus() {
  try {
    const status = readFileSync("/proc/self/status", "utf8")
    const values = {}

    for (const key of ["NoNewPrivs", "Seccomp", "Seccomp_filters", "CapBnd"]) {
      const match = status.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
      values[key] = match?.[1] ?? null
    }

    return values
  } catch {
    return null
  }
}

function runLoopbackBindProbe() {
  return new Promise((resolve) => {
    const server = createServer()

    server.once("error", (error) => {
      resolve({
        ok: false,
        errorCode: error.code ?? null,
        errorMessage: error.message,
      })
    })
    server.listen(0, "127.0.0.1", () => {
      server.close((error) => {
        resolve({
          ok: error === undefined,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
        })
      })
    })
  })
}

async function main() {
  const pipedCapture = runPipedCaptureProbe()
  const fileCapture = runFileCaptureProbe()
  const loopbackBind = await runLoopbackBindProbe()
  const isolation = readIsolationStatus()
  const seccompFilterActive = isolation?.Seccomp
    ? isolation.Seccomp === "2"
    : null
  const recommendations = []

  if (!pipedCapture.ok && fileCapture.ok) {
    recommendations.push(
      "Use file-backed subprocess capture for tests; reserve scoped unsandboxed execution for tools that require child-process pipes or IPC.",
    )
  } else if (!fileCapture.ok) {
    recommendations.push(
      "Child process execution remains restricted; inspect the Codex sandbox and container boundary before running dependent tools.",
    )
  }

  if (!loopbackBind.ok) {
    recommendations.push(
      "Use a narrowly scoped approval for commands such as the canonical Next.js build that require loopback IPC.",
    )
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Node subprocess capture and loopback binding work normally in this environment.",
    )
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        runtime: {
          node: process.version,
          platform: process.platform,
          architecture: process.arch,
        },
        isolation,
        seccompFilterActive,
        isolationScope:
          "Seccomp status and capability probes do not establish whether the Codex sandbox is active or verify filesystem isolation. Check the runner policy separately.",
        probes: {
          pipedCapture,
          fileCapture,
          loopbackBind,
        },
        recommendation: recommendations.join(" "),
      },
      null,
      2,
    )}\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
