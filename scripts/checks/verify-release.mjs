import { pathToFileURL } from "node:url"
import {
  assertMatchingSource,
  readSourceState,
} from "../shared/source-provenance.mjs"
import { runWorkspaceChecks } from "./check-workspace.mjs"

export const RELEASE_CHECKS = [
  ["pnpm", "run", "release:check"],
  ["pnpm", "run", "verify"],
  ["pnpm", "run", "build"],
  ["pnpm", "run", "test:e2e:web"],
  ["pnpm", "run", "test:e2e:admin"],
  ["pnpm", "run", "audit:release"],
]

export function verifyRelease({
  readSource = readSourceState,
  runChecks = runWorkspaceChecks,
} = {}) {
  const source = readSource()
  const status = runChecks({ steps: RELEASE_CHECKS })
  if (status !== 0) return status
  assertMatchingSource(readSource(), source)
  console.log(
    "Release checks passed for the source revision recorded in delivery evidence.",
  )
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = verifyRelease()
  } catch {
    console.error(
      "Release source validation failed: commit the intended source, rebuild matching artifacts and rerun verification without source changes.",
    )
    process.exitCode = 1
  }
}
