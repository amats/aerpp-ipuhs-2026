import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  environmentDirectory,
  generatedEnvironmentDirectory,
} from "@aerpp/config/workspace"
import { cli, run } from "../shared/delivery.mjs"

export function selectOldImages(
  images,
  containers,
  protectedReferences,
  repositories,
) {
  const protectedIds = new Set(containers.map((container) => container.Image))
  const groups = new Map()
  for (const image of images) {
    const refs = [...(image.RepoTags ?? []), ...(image.RepoDigests ?? [])]
    if (
      protectedReferences.some(
        (reference) => reference === image.Id || refs.includes(reference),
      )
    )
      protectedIds.add(image.Id)
    const tags = (image.RepoTags ?? []).filter((tag) => tag !== "<none>:<none>")
    const labels = image.Config?.Labels ?? {}
    const managed =
      ["web", "admin", "support"].includes(labels["io.aerpp.component"]) &&
      ["test", "production"].includes(labels["io.aerpp.environment"])
    if (
      (!tags.length && !managed) ||
      tags.some((tag) => !repositories.has(tag.slice(0, tag.lastIndexOf(":"))))
    ) {
      protectedIds.add(image.Id)
      continue
    }
    if (!tags.length) {
      const group = `${labels["io.aerpp.component"]}:${labels["io.aerpp.environment"]}`
      const entries = groups.get(group) ?? []
      entries.push(image)
      groups.set(group, entries)
    }
    for (const tag of tags) {
      const repository = tag.slice(0, tag.lastIndexOf(":"))
      // Support's two environment tags share one local repository.
      const group = managed
        ? `${labels["io.aerpp.component"]}:${labels["io.aerpp.environment"]}`
        : repository === "aerpp-support"
          ? `support:${tag.split(":").at(-1).split("-")[0]}`
          : (repositories.get?.(repository) ?? repository)
      const entries = groups.get(group) ?? []
      entries.push(image)
      groups.set(group, entries)
    }
  }
  for (const entries of groups.values()) {
    entries.sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))
    protectedIds.add(entries[0].Id)
  }
  return images.filter((image) => !protectedIds.has(image.Id))
}

function inventory() {
  const ids = [
    ...new Set(
      run("docker", ["image", "ls", "--quiet", "--no-trunc"])
        .split("\n")
        .filter(Boolean),
    ),
  ]
  const containers = run("docker", ["ps", "--all", "--quiet"])
    .split("\n")
    .filter(Boolean)
  return {
    images: ids.length
      ? JSON.parse(run("docker", ["image", "inspect", ...ids]))
      : [],
    containers: containers.length
      ? JSON.parse(run("docker", ["container", "inspect", ...containers]))
      : [],
  }
}

export function maintainLocalImages(apply = false) {
  if (typeof apply !== "boolean")
    throw new Error("Local image maintenance apply flag must be a boolean")
  const repositories = new Map([
    ["aerpp-admin-test", "admin:test"],
    ["aerpp-admin-production", "admin:production"],
    ["aerpp-support", "support"],
  ])
  const references = []
  const collect = (value) => {
    if (typeof value === "string") references.push(value)
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect)
  }
  for (const environment of ["test", "production"]) {
    const configFile = resolve(environmentDirectory(environment), "config.json")
    if (!existsSync(configFile)) continue
    const config = JSON.parse(readFileSync(configFile))
    if (config.shared?.participantApiServerId)
      repositories.set(
        config.shared.participantApiServerId,
        `web:${environment}`,
      )
    const base = `${config.infrastructure.region}-docker.pkg.dev/${config.projectId}`
    repositories.set(`${base}/aerpp-support/support`, `support:${environment}`)
    repositories.set(
      `${base}/${config.infrastructure.repository ?? "aerpp-admin"}/admin`,
      `admin:${environment}`,
    )
    const output = generatedEnvironmentDirectory(environment)
    for (const name of [
      "admin-image",
      "admin-prepared",
      "admin-deployed",
      "support-image",
      "support-deployment",
      "web-image",
      "web-bundle",
    ]) {
      const file = resolve(output, `${name}.json`)
      if (existsSync(file)) collect(JSON.parse(readFileSync(file)))
    }
  }
  const current = inventory()
  const candidates = selectOldImages(
    current.images,
    current.containers,
    references,
    repositories,
  )
  let removed = 0
  if (apply === true) {
    for (const candidate of candidates) {
      const refreshed = inventory()
      if (
        !selectOldImages(
          refreshed.images,
          refreshed.containers,
          references,
          repositories,
        ).some((image) => image.Id === candidate.Id)
      )
        throw new Error("Local image protection changed; rerun retention")
      // Never force removal; Docker rejects container references and conflicting tags.
      for (const tag of candidate.RepoTags?.length
        ? candidate.RepoTags
        : [candidate.Id]) {
        const inspected = JSON.parse(
          run("docker", ["image", "inspect", tag]),
        )[0]
        if (inspected.Id !== candidate.Id)
          throw new Error("Local image tag changed; rerun retention")
        run("docker", ["image", "rm", tag])
      }
      removed++
    }
    run("docker", [
      "buildx",
      "prune",
      "--force",
      "--max-used-space=5GB",
      "--reserved-space=1GB",
    ])
  }
  console.log(
    `Local image retention: ${candidates.length} old managed images, ${removed} removed; latest generation and referenced/container images protected. ${apply === true ? "Old build cache trimmed toward 5 GB." : "Dry run only."}`,
  )
  return { candidates: candidates.length, removed }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = cli(() => {
    if (
      process.argv.slice(2).some((argument) => argument !== "--apply") ||
      process.argv.length > 3
    )
      throw new Error("Usage: private:images [--apply]")
    maintainLocalImages(process.argv.includes("--apply"))
  })
