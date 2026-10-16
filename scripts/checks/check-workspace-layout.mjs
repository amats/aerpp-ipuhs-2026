import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DOCKER_BOUNDARY =
  "# Shared exclusions: keep identical across application Docker contexts."
const REQUIRED_EXCLUSIONS = [
  "**/private",
  "**/generated",
  "**/secrets",
  "**/.env*",
  "**/.secret*",
  "**/gcp-*.json",
  "**/*service-account*.json",
  "**/*adminsdk*.json",
  "**/client_secret*.json",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/node_modules",
  "**/.next",
  "**/dist",
  "**/build",
  "**/test-support",
  "**/tests",
  "**/e2e",
  "**/*.test.*",
]

function exportPaths(value) {
  if (typeof value === "string") return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(exportPaths)
}

export function findWorkspaceLayoutViolations(root = ROOT) {
  const violations = []
  let sharedExclusions
  for (const area of ["apps", "packages"]) {
    const directory = join(root, area)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const owner = `${area}/${entry.name}`
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.name))
        violations.push(`${owner}: use a lower-case kebab-case directory name`)
      const manifestPath = join(root, owner, "package.json")
      if (!existsSync(manifestPath)) {
        violations.push(`${owner}: missing package.json`)
        continue
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      if (manifest.private !== true)
        violations.push(`${owner}: package.json must set private to true`)
      if (!existsSync(join(root, owner, "src")))
        violations.push(`${owner}: implementation belongs in src/`)
      for (const name of [
        "private",
        "secrets",
        "test",
        "__tests__",
        "fixtures",
      ]) {
        if (existsSync(join(root, owner, name)))
          violations.push(`${owner}: misplaced ${name}/; see docs/structure.md`)
      }
      if (area === "packages") {
        for (const target of exportPaths(manifest.exports)) {
          if (!target.startsWith("./src/") || target.includes("..", 2))
            violations.push(
              `${owner}: exported implementation must live in src/`,
            )
          else if (!existsSync(join(root, owner, target)))
            violations.push(`${owner}: exported source file is missing`)
        }
        if (!Array.isArray(manifest.files) || !manifest.files.length)
          violations.push(
            `${owner}: define an explicit package files allowlist`,
          )
        continue
      }
      const ignoreFile = join(root, owner, "Dockerfile.dockerignore")
      if (!existsSync(ignoreFile)) {
        violations.push(`${owner}: missing Dockerfile.dockerignore`)
        continue
      }
      const contents = readFileSync(ignoreFile, "utf8")
      const rules = contents
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
      const boundary = contents.indexOf(DOCKER_BOUNDARY)
      const exclusions = boundary < 0 ? "" : contents.slice(boundary)
      if (rules[0] !== "**" || !rules.some((rule) => rule.startsWith("!")))
        violations.push(
          `${owner}: Docker context must start excluded and allow explicit inputs`,
        )
      if (
        !exclusions ||
        REQUIRED_EXCLUSIONS.some(
          (rule) => !exclusions.split(/\r?\n/).includes(rule),
        )
      )
        violations.push(
          `${owner}: Docker context lacks shared private/output exclusions`,
        )
      if (exclusions.split(/\r?\n/).some((rule) => rule.startsWith("!")))
        violations.push(
          `${owner}: Docker inputs must not override shared exclusions`,
        )
      if (sharedExclusions !== undefined && exclusions !== sharedExclusions)
        violations.push(
          `${owner}: shared Docker exclusions differ between applications`,
        )
      sharedExclusions ??= exclusions
    }
  }
  const defaultIgnore = readFileSync(join(root, ".dockerignore"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
  if (defaultIgnore.length !== 1 || defaultIgnore[0] !== "**")
    violations.push(
      "Root Docker context must deny all inputs; select an application Dockerfile",
    )
  return violations
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const violations = findWorkspaceLayoutViolations()
  if (violations.length) {
    console.error(["Workspace layout check failed:", ...violations].join("\n"))
    process.exitCode = 1
  } else {
    console.log(
      "Workspace source layout, package visibility and Docker exclusions passed.",
    )
  }
}
