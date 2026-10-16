import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

// Include owners without manifests so documentation and guidance stay checked.
export function findWorkspaceDirectories(root) {
  const directories = [root]
  for (const parent of ["apps", "packages"]) {
    const directory = path.join(root, parent)
    if (existsSync(directory) !== true) continue
    const children = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() === true)
      .map((entry) => entry.name)
      .sort()
    directories.push(...children.map((name) => path.join(directory, name)))
  }
  return directories
}
