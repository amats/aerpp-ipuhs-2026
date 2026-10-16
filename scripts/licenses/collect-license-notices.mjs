import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const APPLICATIONS = ["web", "admin", "support"]

export function collectNativeNotices(bundle, installedVersions) {
  const expected = Object.fromEntries(
    bundle.components.map((component) => [component.name, component.version]),
  )
  if (
    Object.keys(expected).length !== bundle.components.length ||
    Object.keys(expected).length !== Object.keys(installedVersions).length ||
    Object.entries(expected).some(
      ([name, version]) => installedVersions[name] !== version,
    )
  ) {
    throw new Error(
      "Native component versions changed; review license supplements",
    )
  }
  function notice(file, entry) {
    if (
      !entry.text?.trim() ||
      createHash("sha256").update(entry.text).digest("hex") !== entry.sha256
    ) {
      throw new Error(
        "Native notice text is empty or differs from its recorded source",
      )
    }
    return { file, text: entry.text }
  }
  return [
    ...bundle.components.flatMap((component) => {
      if (!component.notices.length)
        throw new Error(`Missing native component notices: ${component.name}`)
      return component.notices.map((entry) =>
        notice(`${component.source}#${entry.path}`, entry),
      )
    }),
    ...bundle.commonNotices.map((entry) => notice(entry.source, entry)),
  ]
}

export function collectNoticeFiles(directory, prefix = "") {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name, "en"),
  )) {
    const name = join(prefix, entry.name)
    if (
      entry.isDirectory() &&
      !["node_modules", ".git", "test", "tests", "__tests__"].includes(
        entry.name,
      )
    ) {
      result.push(...collectNoticeFiles(join(directory, entry.name), name))
    } else if (
      entry.isFile() &&
      /(?:^|[._-])(licen[sc]es?|copying|notices?|copyright)([._-]|$)/i.test(
        entry.name,
      )
    ) {
      result.push({
        file: name,
        text: readFileSync(join(directory, entry.name), "utf8"),
      })
    }
  }
  return result
}

export function selectedLicense(manifest) {
  const declared =
    (typeof manifest.license === "string"
      ? manifest.license
      : manifest.license?.type) ||
    manifest.licenses
      ?.map((item) => item.type)
      .filter(Boolean)
      .join(" OR ") ||
    "UNKNOWN"
  const selected = { dompurify: "Apache-2.0", jszip: "MIT" }[manifest.name]
  if (!selected) return declared
  const alternatives = declared.replace(/^\((.*)\)$/, "$1").split(" OR ")
  if (!alternatives.includes(selected))
    throw new Error(
      `Review license selection for ${manifest.name}@${manifest.version}`,
    )
  return selected
}

export function collectApplication(tree, supplements = {}) {
  const packages = new Map()
  const visited = new Set()
  function visit(node) {
    const firstVisit = !visited.has(node.path)
    visited.add(node.path)
    // pnpm also lists optional binaries for other platforms; only installed files are collected.
    if (firstVisit && existsSync(join(node.path, "package.json"))) {
      const manifest = JSON.parse(
        readFileSync(join(node.path, "package.json"), "utf8"),
      )
      if (!manifest.name.startsWith("@aerpp/")) {
        const notices = collectNoticeFiles(node.path)
        const supplement = supplements[`${manifest.name}@${manifest.version}`]
        if (supplement?.nativeBundle) {
          notices.push(
            ...collectNativeNotices(
              JSON.parse(
                readFileSync(
                  join(ROOT, "docs/licenses", supplement.nativeBundle),
                  "utf8",
                ),
              ),
              JSON.parse(
                readFileSync(join(node.path, "versions.json"), "utf8"),
              ),
            ),
          )
        } else if (supplement)
          notices.push({
            file: supplement.source,
            text: readFileSync(
              join(ROOT, "docs/licenses", supplement.file),
              "utf8",
            ),
          })
        if (notices.length === 0) {
          for (const file of readdirSync(node.path).filter((name) =>
            /^readme/i.test(name),
          )) {
            const text = readFileSync(join(node.path, file), "utf8")
            const match = text.match(
              /(?:^|\n)#{1,6} Licen[sc]e[^\n]*\n([\s\S]*)/i,
            )
            if (
              match &&
              /Permission is hereby granted|Redistribution and use|Permission to use, copy/i.test(
                match[1],
              )
            ) {
              notices.push({ file, text: match[1].trim() })
            }
          }
        }
        packages.set(`${manifest.name}@${manifest.version}`, {
          name: manifest.name,
          version: manifest.version,
          license: selectedLicense(manifest),
          source:
            typeof manifest.repository === "string"
              ? manifest.repository
              : (manifest.repository?.url ?? manifest.homepage ?? ""),
          author:
            typeof manifest.author === "string"
              ? manifest.author
              : (manifest.author?.name ?? ""),
          notices,
        })
      }
    }
    for (const key of ["dependencies", "optionalDependencies"]) {
      for (const dependency of Object.values(node[key] ?? {})) visit(dependency)
    }
  }
  visit(tree)
  return [...packages.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"),
  )
}

export function generate({ check = false, audit = false, application } = {}) {
  if (application && !APPLICATIONS.includes(application))
    throw new Error("Unknown application")
  const selectedApplications = application ? [application] : APPLICATIONS
  const trees = selectedApplications.map(
    (app) =>
      JSON.parse(
        execFileSync(
          "pnpm",
          [
            "--filter",
            `@aerpp/${app}`,
            "list",
            "--prod",
            "--depth",
            "Infinity",
            "--json",
          ],
          { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        ),
      )[0],
  )
  const supplements = JSON.parse(
    readFileSync(join(ROOT, "docs/licenses/supplements.json"), "utf8"),
  )
  const records = new Map()
  const target = join(ROOT, "docs/licenses/npm-notices.json")
  if (application) {
    for (const item of JSON.parse(readFileSync(target, "utf8"))) {
      const scopes = item.applications.filter((app) => app !== application)
      if (scopes.length)
        records.set(`${item.name}@${item.version}`, {
          ...item,
          applications: scopes,
        })
    }
  }
  for (const app of selectedApplications) {
    const tree = trees.find((tree) => tree.name === `@aerpp/${app}`)
    if (!tree) throw new Error(`Missing installed application: ${app}`)
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "apps", app, "package.json"), "utf8"),
    )
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const dependency = tree.dependencies?.[name]
      if (!dependency || !existsSync(join(dependency.path, "package.json"))) {
        throw new Error(
          `Missing installed dependency for ${app}: ${name}; install the locked dependencies first`,
        )
      }
    }
    for (const item of collectApplication(tree, supplements)) {
      const key = `${item.name}@${item.version}`
      const existing = records.get(key)
      if (existing) {
        records.set(key, {
          ...item,
          applications: [...existing.applications, app].sort(),
        })
      } else records.set(key, { ...item, applications: [app] })
    }
  }
  const data = [...records.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"),
  )
  for (const item of data) item.applications.sort()
  const content = `${JSON.stringify(data, null, 2)}\n`
  if (check) {
    if (!existsSync(target) || readFileSync(target, "utf8") !== content)
      throw new Error("License notices are stale; run pnpm run license")
  } else writeFileSync(target, content)
  const missing = data.filter(
    (item) =>
      (item.notices.length === 0 || item.license === "UNKNOWN") &&
      (!application || item.applications.includes(application)),
  )
  console.log(
    `${relative(ROOT, target)}: ${data.length} packages; ${missing.length} require supplementary notice review`,
  )
  for (const item of missing)
    console.log(`  ${item.name}@${item.version}: ${item.license}`)
  if (audit && missing.length)
    throw new Error(
      "License notice coverage is incomplete; see THIRD_PARTY_NOTICES.md",
    )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const appIndex = process.argv.indexOf("--app")
    if (appIndex !== -1 && !process.argv[appIndex + 1])
      throw new Error("--app requires an application")
    generate({
      check: process.argv.includes("--check"),
      audit: process.argv.includes("--audit"),
      application: appIndex === -1 ? undefined : process.argv[appIndex + 1],
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
