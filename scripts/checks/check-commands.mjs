import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { WORKSPACE_CHECKS } from "./check-workspace.mjs"
import { findDocumentationFiles } from "./documentation-files.mjs"
import { findPnpmScriptViolations } from "./pnpm-script-references.mjs"
import { readWorkspaceManifests } from "./workspace-manifests.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
export function findCommandViolations(root) {
  const manifests = readWorkspaceManifests(root)
  const violations = []
  const check = (source, location, directory) => {
    for (const message of findPnpmScriptViolations(
      source,
      manifests,
      directory,
    ))
      violations.push(`${location}: ${message}`)
  }
  for (const file of findDocumentationFiles(root)) {
    // Historical release records describe commands that may no longer exist.
    if (path.basename(file) === "CHANGELOG.md") continue
    check(readFileSync(file, "utf8"), path.relative(root, file), root)
  }
  for (const manifest of manifests) {
    for (const [name, script] of Object.entries(manifest.scripts)) {
      check(
        script,
        `${path.relative(root, path.join(manifest.directory, "package.json"))} scripts.${name}`,
        manifest.directory,
      )
    }
  }
  if (
    manifests[0]?.scripts.check === "node scripts/checks/check-workspace.mjs"
  ) {
    for (const step of WORKSPACE_CHECKS)
      check(step.join(" "), "scripts/checks/check-workspace.mjs", root)
  }
  return violations
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const violations = findCommandViolations(ROOT)
  if (violations.length > 0) {
    console.error(["Command reference check failed:", ...violations].join("\n"))
    process.exitCode = 1
  } else {
    console.log("Documentation commands and package script targets passed.")
  }
}
