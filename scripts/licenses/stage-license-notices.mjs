import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
export const APPLICATION_LICENSE_FILES = {
  web: [
    "APACHE-2.0.txt",
    "BSD-2-CLAUSE.txt",
    "OFL-1.1.txt",
    "HAI-DEF-TERMS.txt",
    "HAI-DEF-PROHIBITED-USE.txt",
  ],
  admin: ["APACHE-2.0.txt", "OFL-1.1.txt"],
}

export function repositoryUrl(value) {
  if (typeof value !== "string" || !value) return undefined
  let normalized = value
    .replace(/^git\+(?=https?:\/\/)/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/\.git(?=#|$)/, "")
  if (/^[\w.-]+\/[\w.-]+$/.test(normalized))
    normalized = `https://github.com/${normalized}`
  try {
    const url = new URL(normalized)
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function stageLicenseNotices(root, application, { check = false } = {}) {
  if (!Object.hasOwn(APPLICATION_LICENSE_FILES, application))
    throw new Error("Unknown license display application")
  const inventory = JSON.parse(
    readFileSync(join(root, "docs/licenses/npm-notices.json"), "utf8"),
  )
  const files = new Map([
    ["LICENSE", readFileSync(join(root, "LICENSE"))],
    ["NOTICE", readFileSync(join(root, "NOTICE"))],
    [
      "dependencies.json",
      Buffer.from(
        `${JSON.stringify(
          inventory
            .filter((item) => item.applications.includes(application))
            .map((item) => ({
              ...item,
              sourceUrl: repositoryUrl(item.source),
            })),
          null,
          2,
        )}\n`,
      ),
    ],
    ...APPLICATION_LICENSE_FILES[application].map((file) => [
      file,
      readFileSync(join(root, "docs/licenses", file)),
    ]),
  ])
  const target = join(root, "apps", application, "generated/licenses")
  if (check) {
    if (
      !existsSync(target) ||
      readdirSync(target).length !== files.size ||
      [...files].some(
        ([file, contents]) =>
          !existsSync(join(target, file)) ||
          !readFileSync(join(target, file)).equals(contents),
      )
    ) {
      throw new Error(
        `${application} license copies are stale; run pnpm run license:stage`,
      )
    }
    return
  }
  // Read all inputs first and replace changed files atomically so a running app never sees a truncated file.
  mkdirSync(target, { recursive: true })
  for (const [file, contents] of files) {
    const destination = join(target, file)
    if (existsSync(destination) && readFileSync(destination).equals(contents))
      continue
    const temporary = join(target, `.${file}.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, contents)
      renameSync(temporary, destination)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  for (const file of readdirSync(target)) {
    if (!files.has(file) && !file.endsWith(".tmp"))
      rmSync(join(target, file), { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const applications = process.argv
      .slice(2)
      .filter((arg) => !arg.startsWith("--"))
    for (const application of applications.length
      ? applications
      : Object.keys(APPLICATION_LICENSE_FILES)) {
      stageLicenseNotices(ROOT, application, {
        check: process.argv.includes("--check"),
      })
      console.log(
        `${application}: app-local license copies ${process.argv.includes("--check") ? "checked" : "generated"}`,
      )
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
