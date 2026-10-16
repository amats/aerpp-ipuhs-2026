import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { setTimeout } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import { readAdminDeployment } from "@aerpp/config/admin-deployment"
import { environmentDirectory } from "@aerpp/config/workspace"
import {
  cloudEnvironment,
  gcloud,
  outputDirectory,
  privateJson,
} from "../shared/delivery.mjs"
import { collectImageRetentionPins } from "./image-retention-policy.mjs"

export function selectRegistryDeletion(
  images,
  manifests,
  pins,
  now = Date.now(),
  graceMs = 86400000,
) {
  const byDigest = new Map(images.map((image) => [image.version, image]))
  if (
    images.some(
      (image) =>
        !/^sha256:[a-f0-9]{64}$/.test(image.version) ||
        !Number.isFinite(Date.parse(image.createTime)),
    ) ||
    pins.some((pin) => !byDigest.has(pin))
  )
    throw new Error("Incomplete registry inventory or missing protected digest")
  const kept = new Set(pins)
  const packages = new Set(images.map((image) => image.package))
  for (const name of packages) {
    const latest = images
      .filter((image) => image.package === name)
      .sort((a, b) => Date.parse(b.createTime) - Date.parse(a.createTime))[0]
    kept.add(latest.version)
  }
  for (const image of images) {
    if (!manifests[image.version]) throw new Error("Missing registry manifest")
    if (now - Date.parse(image.createTime) < graceMs) kept.add(image.version)
  }
  // Keep complete index/platform/attestation families, including parents of live platform digests.
  let changed = true
  while (changed) {
    changed = false
    for (const image of images) {
      const children = (manifests[image.version].manifests ?? []).map(
        (item) => item.digest,
      )
      if (children.some((child) => !byDigest.has(child)))
        throw new Error("Incomplete manifest graph")
      if (
        kept.has(image.version) ||
        children.some((child) => kept.has(child))
      ) {
        for (const digest of [image.version, ...children]) {
          if (!kept.has(digest)) {
            kept.add(digest)
            changed = true
          }
        }
      }
    }
  }
  const remaining = new Set(
    images
      .filter((image) => !kept.has(image.version))
      .map((image) => image.version),
  )
  const ordered = []
  while (remaining.size) {
    const roots = [...remaining].filter(
      (digest) =>
        ![...remaining].some((parent) =>
          manifests[parent].manifests?.some((child) => child.digest === digest),
        ),
    )
    if (!roots.length) throw new Error("Cyclic manifest graph")
    for (const digest of roots) {
      remaining.delete(digest)
      ordered.push(digest)
    }
  }
  return ordered
}

export async function main(args) {
  const [environment, ...options] = args
  cloudEnvironment(environment)
  if (
    options.some((option) => !["--apply", "--finalize"].includes(option)) ||
    new Set(options).size !== options.length
  )
    throw new Error(
      "Usage: cloud:images test|production [--apply] [--finalize]",
    )
  const apply = options.includes("--apply")
  const finalize = options.includes("--finalize")
  const config = JSON.parse(
    readFileSync(resolve(environmentDirectory(environment), "config.json")),
  )
  const project = config.projectId
  const region = config.infrastructure.region
  const output = outputDirectory(environment)
  const read = (name) => {
    const file = resolve(output, `${name}.json`)
    return existsSync(file) ? JSON.parse(readFileSync(file)) : undefined
  }
  const admin = readAdminDeployment(environment)
  if (finalize) {
    const deployedAdmin = read("admin-deployed")
    const checkedAdmin = read("admin-cloud-check")
    const deployedSupport = read("support-deployment")
    const checkedSupport = read("support-cloud-check")
    if (
      read("admin-prepared") ||
      !deployedAdmin ||
      !deployedSupport ||
      deployedAdmin.project !== project ||
      checkedAdmin?.project !== project ||
      checkedSupport?.project !== project ||
      checkedAdmin.ok !== true ||
      checkedAdmin.image !== deployedAdmin.digestImage ||
      checkedAdmin.revision !== deployedAdmin.revision ||
      checkedSupport.image !== deployedSupport.image ||
      checkedSupport.runtimeVersion !== deployedSupport.runtimeVersion
    )
      throw new Error(
        "Final cleanup requires matching accepted cloud deployments and no staged Admin image",
      )
  }
  const pins = () => {
    const accepted = read("admin-prepared") ?? read("admin-deployed")
    const deployment = read("support-deployment")
    if (
      (accepted && accepted.project !== project) ||
      (deployment && deployment.project !== project)
    )
      throw new Error("Cross-project image evidence")
    return collectImageRetentionPins(
      project,
      region,
      { repository: admin.repository, image: accepted?.digestImage },
      deployment,
    )
  }
  const protectedPins = pins()
  const token = gcloud(project, ["auth", "print-access-token"])
  const report = {
    _comment: "Generated registry deletion evidence; do not edit",
    environment,
    createdAt: new Date().toISOString(),
    apply,
    finalize,
    repositories: [],
  }
  for (const [component, repository, packageName] of [
    ["admin", admin.repository, "admin"],
    ["support", "aerpp-support", "support"],
  ]) {
    const base = `${region}-docker.pkg.dev/${project}/${repository}`
    const images = JSON.parse(
      gcloud(project, [
        "artifacts",
        "docker",
        "images",
        "list",
        base,
        "--include-tags",
        "--format=json",
      ]),
    )
    if (images.some((image) => image.package !== `${base}/${packageName}`))
      throw new Error("Unexpected package in managed repository")
    const manifests = {}
    for (const image of images) {
      if (!/^sha256:[a-f0-9]{64}$/.test(image.version))
        throw new Error("Invalid registry digest")
      const response = await fetch(
        `https://${region}-docker.pkg.dev/v2/${project}/${repository}/${packageName}/manifests/${image.version}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept:
              "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
          },
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        },
      )
      if (!response.ok) throw new Error("Cannot inspect registry manifest")
      manifests[image.version] = await response.json()
    }
    const candidates = selectRegistryDeletion(
      images,
      manifests,
      protectedPins[component],
      Date.now(),
      finalize ? 0 : 86400000,
    )
    const result = { component, before: images.length, candidates, deleted: [] }
    report.repositories.push(result)
    privateJson(resolve(output, "image-retention.json"), report)
    if (apply) {
      if (JSON.stringify(pins()) !== JSON.stringify(protectedPins))
        throw new Error("Live image protection changed; rerun cleanup")
      for (const digest of candidates) {
        if (JSON.stringify(pins()) !== JSON.stringify(protectedPins))
          throw new Error("Live image protection changed; rerun cleanup")
        try {
          gcloud(project, [
            "artifacts",
            "docker",
            "images",
            "delete",
            `${base}/${packageName}@${digest}`,
            "--delete-tags",
          ])
        } catch {
          // Operation polling can fail after deletion was accepted. Verify absence without resubmitting it.
          let absent = false
          for (let attempt = 0; attempt < 5; attempt++) {
            const remaining = JSON.parse(
              gcloud(project, [
                "artifacts",
                "docker",
                "images",
                "list",
                base,
                "--format=json",
              ]),
            )
            if (!remaining.some((image) => image.version === digest)) {
              absent = true
              break
            }
            await setTimeout(2000)
          }
          if (!absent)
            throw new Error("Deletion completion could not be verified")
        }
        result.deleted.push(digest)
        privateJson(resolve(output, "image-retention.json"), report)
      }
    }
    console.log(
      `${environment} ${component}: ${images.length} manifests, ${candidates.length} old candidates, ${result.deleted.length} removed`,
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main(process.argv.slice(2))
  } catch {
    console.error(
      "Registry cleanup stopped; inspect private image-retention evidence and selected cloud access. Protected images are never intentionally deleted.",
    )
    process.exitCode = 1
  }
}
