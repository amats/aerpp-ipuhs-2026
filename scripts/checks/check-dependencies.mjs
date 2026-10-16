import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parse } from "yaml"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]
const COUPLED_PACKAGES = [
  ["next", "@next/mdx"],
  ["react", "react-dom"],
  ["tailwindcss", "@tailwindcss/postcss"],
]

export function findDependencyViolations(workspace, manifests) {
  const violations = []
  const catalogs = {
    ...workspace.catalogs,
    default: workspace.catalog ?? workspace.catalogs?.default ?? {},
  }
  const catalogPackages = new Set(Object.values(catalogs).flatMap(Object.keys))
  const workspacePackages = new Set(
    Object.values(manifests).map((manifest) => manifest.name),
  )
  const references = new Set()
  const consumers = new Map()

  for (const [owner, manifest] of Object.entries(manifests)) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        const location = `${owner}/package.json ${field}.${name}`
        if (workspacePackages.has(name)) {
          if (specifier !== "workspace:*")
            violations.push(
              `${location}: use workspace:* for internal packages`,
            )
          continue
        }
        const owners = consumers.get(name) ?? new Set()
        owners.add(owner)
        consumers.set(name, owners)
        if (specifier.startsWith("catalog:")) {
          const catalogName = specifier.slice("catalog:".length) || "default"
          if (!Object.hasOwn(catalogs[catalogName] ?? {}, name))
            violations.push(`${location}: missing ${catalogName} catalog entry`)
          references.add(`${catalogName}:${name}`)
        } else if (catalogPackages.has(name)) {
          violations.push(
            `${location}: reference the catalog instead of a version`,
          )
        }
      }
    }
  }

  for (const [name, owners] of consumers) {
    if (owners.size > 1 && !catalogPackages.has(name))
      violations.push(
        `${name}: shared by ${[...owners].join(", ")}; use a catalog`,
      )
  }
  for (const group of COUPLED_PACKAGES) {
    if (group.some((name) => catalogPackages.has(name))) {
      for (const name of group) {
        if (consumers.has(name) && !catalogPackages.has(name))
          violations.push(
            `${name}: upgraded with ${group.join("/")}; use a catalog`,
          )
      }
    }
  }
  for (const [catalogName, entries] of Object.entries(catalogs)) {
    for (const name of Object.keys(entries)) {
      if (workspacePackages.has(name))
        violations.push(
          `${catalogName}:${name}: internal packages use workspace:*`,
        )
      if (!references.has(`${catalogName}:${name}`))
        violations.push(
          `${catalogName}:${name}: remove the unused catalog entry`,
        )
    }
    for (const [first, second] of COUPLED_PACKAGES) {
      if (
        entries[first] !== undefined &&
        entries[second] !== undefined &&
        entries[first] !== entries[second]
      )
        violations.push(
          `${catalogName}: keep ${first} and ${second} on the same version range`,
        )
    }
  }
  return violations
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const owners = [
    ".",
    ...["apps", "packages"].flatMap((area) =>
      readdirSync(join(ROOT, area), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${area}/${entry.name}`),
    ),
  ]
  const manifests = Object.fromEntries(
    owners.map((owner) => [
      owner,
      JSON.parse(readFileSync(join(ROOT, owner, "package.json"), "utf8")),
    ]),
  )
  const workspace = parse(
    readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"),
  )
  const violations = findDependencyViolations(workspace, manifests)
  if (violations.length) {
    console.error(["Dependency check failed:", ...violations].join("\n"))
    process.exitCode = 1
  } else {
    console.log("Workspace dependencies and catalogs passed.")
  }
}
