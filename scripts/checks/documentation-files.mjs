import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { findWorkspaceDirectories } from "./workspace-directories.mjs"

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".terraform",
  "generated",
  "private",
])

export function findMarkdownFiles(directory, recursive = false) {
  if (existsSync(directory) !== true) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory() === true)
      return recursive === true && SKIPPED_DIRECTORIES.has(entry.name) !== true
        ? findMarkdownFiles(file, true)
        : []
    return entry.isFile() === true && entry.name.endsWith(".md") === true
      ? [file]
      : []
  })
}

export function findDocumentationFiles(root) {
  const files = findMarkdownFiles(root)
  for (const directory of [
    "config/example",
    "config/common",
    "docs",
    "skills",
    "scripts",
    "infra",
    "patches",
  ]) {
    files.push(...findMarkdownFiles(path.join(root, directory), true))
  }
  for (const owner of findWorkspaceDirectories(root).slice(1)) {
    files.push(...findMarkdownFiles(owner))
    for (const directory of ["docs", "skills"]) {
      files.push(...findMarkdownFiles(path.join(owner, directory), true))
    }
  }
  return files.sort()
}
