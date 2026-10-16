import { spawnSync } from "node:child_process"
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import { generatedEnvironmentDirectory, ROOT } from "@aerpp/config/workspace"

function directory(path) {
  if (!lstatSync(path).isDirectory())
    throw new Error("Expected a real directory")
}

function filesSize(path) {
  const entry = lstatSync(path)
  if (entry.isFile()) return entry.size
  if (!entry.isDirectory())
    throw new Error("Symlinks and special files are not supported")
  return readdirSync(path).reduce(
    (total, name) => total + filesSize(join(path, name)),
    0,
  )
}

export function acquireBundleLock(output) {
  const lock = join(output, ".bundle-operation.lock")
  const fd = openSync(lock, "wx", 0o600)
  closeSync(fd)
  return () => unlinkSync(lock)
}

export function inspectBundles(output, keep = 2, pins = []) {
  if (!Number.isSafeInteger(keep) || keep < 2)
    throw new Error("Keep at least two generations")
  directory(output)
  const bundles = join(output, "bundles")
  directory(bundles)
  const pointer = JSON.parse(
    readFileSync(join(output, "web-bundle.json"), "utf8"),
  )
  const entries = readdirSync(bundles)
    .map((name) => {
      const match = /^test-(\d{13})-[a-f0-9]{12}$/.exec(name)
      if (!match)
        throw new Error("Unrecognized bundle entry; review it before archiving")
      const path = join(bundles, name)
      directory(path)
      const bytes = filesSize(path)
      const release = JSON.parse(
        readFileSync(join(path, "release.json"), "utf8"),
      )
      if (release.releaseId !== name || release.environment !== "test")
        throw new Error("Bundle identity mismatch")
      for (const required of ["SHA256SUMS", "images.tar", "release-id.txt"])
        if (!lstatSync(join(path, required)).isFile())
          throw new Error("Incomplete bundle")
      if (readFileSync(join(path, "release-id.txt"), "utf8").trim() !== name)
        throw new Error("Bundle release marker mismatch")
      return { name, bytes, created: Number(match[1]) }
    })
    .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name))
  const names = new Set(entries.map((entry) => entry.name))
  if (
    !names.has(pointer.releaseId) ||
    resolve(pointer.destination) !== join(bundles, pointer.releaseId)
  )
    throw new Error(
      "Current export pointer does not identify an available bundle",
    )
  if (!Array.isArray(pins) || pins.some((name) => !names.has(name)))
    throw new Error("Retention pins must identify available bundles")
  return entries.map((entry, index) => ({
    ...entry,
    reason:
      entry.name === pointer.releaseId
        ? "current export"
        : pins.includes(entry.name)
          ? "pinned"
          : index < keep
            ? "recent generation"
            : "archive candidate",
  }))
}

function tar(args) {
  const env = applicationEnvironment({})
  delete env.TAR_OPTIONS
  delete env.GZIP
  const result = spawnSync("tar", args, {
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  })
  if (result.error || result.status !== 0)
    throw new Error(
      "Archive creation or byte comparison failed; source retained",
    )
}

export function archiveBundles(output, archiveRoot, keep = 2, pins = []) {
  directory(output)
  const unlock = acquireBundleLock(output)
  try {
    const candidates = inspectBundles(output, keep, pins).filter(
      (entry) => entry.reason === "archive candidate",
    )
    mkdirSync(archiveRoot, { recursive: true, mode: 0o700 })
    directory(archiveRoot)
    const archived = []
    for (const entry of candidates) {
      const destination = join(archiveRoot, `${entry.name}.tar.gz`)
      if (existsSync(destination))
        throw new Error("Archive already exists; review before retrying")
      const temporary = `${destination}.${process.pid}.tmp`
      const fd = openSync(temporary, "wx", 0o600)
      closeSync(fd)
      try {
        tar([
          "--create",
          "--gzip",
          "--file",
          temporary,
          "--directory",
          join(output, "bundles"),
          "--",
          entry.name,
        ])
        tar([
          "--compare",
          "--gzip",
          "--file",
          temporary,
          "--directory",
          join(output, "bundles"),
        ])
        // Recheck protections before removing the expanded copy. The archive retains every byte.
        const current = inspectBundles(output, keep, pins).find(
          (item) => item.name === entry.name,
        )
        if (current?.reason !== "archive candidate")
          throw new Error("Bundle protection changed; source retained")
        renameSync(temporary, destination)
        rmSync(join(output, "bundles", entry.name), { recursive: true })
        archived.push({
          name: entry.name,
          originalBytes: entry.bytes,
          archiveBytes: lstatSync(destination).size,
        })
      } finally {
        rmSync(temporary, { force: true })
      }
    }
    return archived
  } finally {
    unlock()
  }
}

export function main(args, root = ROOT) {
  if (
    args[0] !== "test" ||
    args.slice(1).some((arg) => arg !== "--archive") ||
    args.length > 2
  )
    throw new Error("Usage: private:bundles test [--archive]")
  const output = generatedEnvironmentDirectory("test", root)
  // Refuse symlinked parents before any write or recursive removal.
  for (const path of ["generated", "generated/test"])
    directory(resolve(root, path))
  for (const path of ["private", "private/retention"]) {
    const parent = resolve(root, path)
    if (lstatSync(parent, { throwIfNoEntry: false }) !== undefined)
      directory(parent)
  }
  const policy = resolve(root, "private/retention/test.json")
  const pins = existsSync(policy)
    ? JSON.parse(readFileSync(policy, "utf8")).releaseIds
    : []
  if (!Array.isArray(pins)) throw new Error("Invalid retention policy")
  if (args.includes("--archive")) {
    const result = archiveBundles(
      output,
      join(output, "bundle-archives"),
      2,
      pins,
    )
    console.log(
      JSON.stringify(
        {
          archived: result,
          savedBytes: result.reduce(
            (sum, entry) => sum + entry.originalBytes - entry.archiveBytes,
            0,
          ),
        },
        null,
        2,
      ),
    )
  } else {
    const entries = inspectBundles(output, 2, pins)
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          bundles: entries,
          archiveCandidateBytes: entries
            .filter((entry) => entry.reason === "archive candidate")
            .reduce((sum, entry) => sum + entry.bytes, 0),
        },
        null,
        2,
      ),
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2))
  } catch {
    console.error(
      "Bundle retention failed. Check arguments, bundle metadata, retention pins, archive conflicts and .bundle-operation.lock. No cloud operations were performed.",
    )
    process.exitCode = 1
  }
}
