import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { findMarkdownFiles } from "./documentation-files.mjs"
import { findMarkdownLinkViolations } from "./markdown-links.mjs"
import { findPnpmScriptViolations } from "./pnpm-script-references.mjs"
import { findWorkspaceDirectories } from "./workspace-directories.mjs"
import { readWorkspaceManifests } from "./workspace-manifests.mjs"

const WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)

function childDirectories(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

export function findSkillViolations(repoRoot) {
  const roots = findWorkspaceDirectories(repoRoot)
  const manifests = readWorkspaceManifests(repoRoot)
  const violations = []
  const documents = new Map()
  const names = new Map()
  const relative = (file) =>
    path.relative(repoRoot, file).split(path.sep).join("/")
  const report = (file, message) =>
    violations.push(`${relative(file)}: ${message}`)

  for (const root of roots) {
    const agentsFile = path.join(root, "AGENTS.md")
    const agents = existsSync(agentsFile)
      ? readFileSync(agentsFile, "utf8")
      : ""
    const indexedNames = [...agents.matchAll(/^- `(repo-[a-z0-9-]+)`:/gm)].map(
      (match) => match[1],
    )
    const skillRoot = path.join(root, "skills")
    const skills = childDirectories(skillRoot)
    for (const name of indexedNames) {
      if (!skills.includes(name))
        report(agentsFile, `indexed skill does not exist (${name})`)
      if (indexedNames.indexOf(name) !== indexedNames.lastIndexOf(name)) {
        report(agentsFile, `duplicate skill index (${name})`)
      }
    }
    for (const name of skills) {
      const file = path.join(skillRoot, name, "SKILL.md")
      if (!/^repo-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
        report(file, `expected repo-<purpose> skill directory (${name})`)
      if (!indexedNames.includes(name))
        report(file, "skill is not indexed in AGENTS.md")
      if (!existsSync(file)) {
        report(file, "missing skill entrypoint")
        continue
      }
      if (names.has(name))
        report(file, `duplicate workspace skill name (${name})`)
      names.set(name, file)
      const source = readFileSync(file, "utf8")
      const frontmatter = source.match(
        /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
      )?.[1]
      if (
        !frontmatter ||
        !new RegExp(`^name: ${name}$`, "m").test(frontmatter) ||
        !/^description: \S.+$/m.test(frontmatter)
      ) {
        report(
          file,
          "expected matching name and nonempty description in frontmatter",
        )
      }
      const indexLine =
        agents.split("\n").find((line) => line.startsWith(`- \`${name}\`:`)) ??
        ""
      if (
        indexedNames.includes(name) &&
        !indexLine.includes(`](skills/${name}/SKILL.md)`)
      )
        report(
          agentsFile,
          `skill index needs a direct entrypoint link (${name})`,
        )
    }
    for (const file of [agentsFile, path.join(root, "CONTRIBUTING.md")]) {
      if (existsSync(file)) documents.set(file, root)
    }
    for (const file of findMarkdownFiles(skillRoot, true))
      documents.set(file, root)
  }

  const anchors = new Map()
  for (const [file, owner] of documents) {
    const source = readFileSync(file, "utf8")
    for (const message of findPnpmScriptViolations(source, manifests, repoRoot))
      report(file, message)
    for (const match of source.matchAll(
      /`((?:src|scripts|skills|test-support|docs)\/[^`\s*?<>]+)`/g,
    )) {
      const referenced = path.resolve(owner, match[1])
      if (!existsSync(referenced))
        report(file, `missing repository path (${match[1]})`)
    }
    violations.push(...findMarkdownLinkViolations(repoRoot, file, anchors))
  }
  return violations
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const violations = findSkillViolations(WORKSPACE_ROOT)
  if (violations.length > 0) {
    console.error(["Skill reference check failed:", ...violations].join("\n"))
    process.exitCode = 1
  } else {
    console.log("Workspace skill reference check passed.")
  }
}
