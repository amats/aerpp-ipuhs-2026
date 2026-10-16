import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { findWorkspaceDirectories } from "./workspace-directories.mjs"

export function readWorkspaceManifests(root) {
  return findWorkspaceDirectories(root).flatMap((directory) => {
    const file = path.join(directory, "package.json")
    if (!existsSync(file)) return []
    const {
      name,
      scripts = {},
      exports,
    } = JSON.parse(readFileSync(file, "utf8"))
    return [{ directory, name, scripts, exports }]
  })
}
