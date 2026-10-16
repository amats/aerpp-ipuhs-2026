import { spawnSync } from "node:child_process"
import { constants } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

export const WORKSPACE_CHECKS = [
  ["pnpm", "run", "license:check"],
  ["pnpm", "run", "contracts:check"],
  ["node", "scripts/checks/check-skills.mjs"],
  ["node", "scripts/checks/check-docs.mjs"],
  ["node", "scripts/checks/check-commands.mjs"],
  ["node", "scripts/checks/check-boundaries.mjs"],
  ["pnpm", "run", "lint:tooling"],
  ["node", "scripts/checks/check-workspace-layout.mjs"],
  ["node", "scripts/checks/check-dependencies.mjs"],
  ["pnpm", "run", "check:documents"],
  ["pnpm", "run", "check:firestore"],
  ["pnpm", "run", "check:config"],
  ["pnpm", "run", "test:tooling"],
  ["pnpm", "run", "check:web"],
  ["pnpm", "run", "check:admin"],
  ["pnpm", "run", "check:support"],
]

export function runWorkspaceChecks({
  steps = WORKSPACE_CHECKS,
  cwd = ROOT,
} = {}) {
  for (const [command, ...args] of steps) {
    const result = spawnSync(command, args, { cwd, stdio: "inherit" })
    if (result.error !== undefined) {
      console.error(`Cannot start verification command: ${command}`)
      return 1
    }
    if (result.signal !== null) return 128 + constants.signals[result.signal]
    if (result.status !== 0) return result.status ?? 1
  }
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runWorkspaceChecks()
}
