import path from "node:path"
import { describe, expect, it } from "vitest"
import { spawnCaptured } from "../test-support/spawn-captured.mjs"

const repoRoot = path.resolve(__dirname, "..")
const scriptPath = path.join(repoRoot, "scripts", "diagnose-sandbox.mjs")

describe("diagnose-sandbox", () => {
  it("reports both piped and file-backed child process probes", () => {
    const result = spawnCaptured(process.execPath, [scriptPath], {
      cwd: repoRoot,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")

    const report = JSON.parse(result.stdout)
    expect(report.runtime.node).toBe(process.version)
    expect(report.seccompFilterActive).toBe(
      report.isolation?.Seccomp ? report.isolation.Seccomp === "2" : null,
    )
    expect(report).not.toHaveProperty("sandboxLikelyActive")
    expect(report.isolationScope).toContain("do not establish")
    expect(report.isolationScope).toContain("filesystem isolation")
    expect(typeof report.probes.pipedCapture.ok).toBe("boolean")
    expect(report.probes.fileCapture.ok).toBe(true)
    expect(report.probes.fileCapture.stdout).toBe("sandbox-child-ok")
    expect(typeof report.probes.loopbackBind.ok).toBe("boolean")
    expect(typeof report.recommendation).toBe("string")
  })
})
