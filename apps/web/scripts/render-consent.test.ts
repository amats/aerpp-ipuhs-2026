import path from "node:path"
import { describe, expect, it } from "vitest"
import { spawnCaptured } from "../test-support/spawn-captured.mjs"

const repoRoot = path.resolve(__dirname, "..")
const scriptPath = path.join(repoRoot, "scripts", "render-consent.mjs")

describe("render-consent", () => {
  it("renders the bundled consent markdown to static HTML", () => {
    const result = spawnCaptured(process.execPath, [scriptPath], {
      cwd: repoRoot,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("<h3>（研究責任者による宣誓）</h3>")
    expect(result.stdout).toContain("研究への参加に同意")
    expect(result.stderr).toBe("")
  })
})
