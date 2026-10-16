import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { assertNoAppEnvFiles } from "@aerpp/config/process"
import { environmentTarget } from "@aerpp/config/targets"
import { ROOT } from "@aerpp/config/workspace"
import { maintainLocalImages } from "../maintenance/image-retention.mjs"
import {
  cli,
  cloudEnvironment,
  outputDirectory,
  privateJson,
  run,
} from "../shared/delivery.mjs"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
} from "../shared/source-provenance.mjs"

export function adminAssets(environment) {
  cloudEnvironment(environment)
  return []
}
export function main(args = process.argv.slice(2)) {
  const [environment, tagOption, ...extra] = args
  cloudEnvironment(environment)
  if (extra.length)
    throw new Error("Usage: admin:build-image test|production [tag]")
  const target = environmentTarget(environment)
  assertNoAppEnvFiles(resolve(ROOT, "apps/admin"))
  const assets = adminAssets(environment)
  const sourceState = readSourceState()
  const revision = sourceState.sourceRevision
  const tag =
    tagOption ??
    `${revision.slice(0, 12)}-${new Date().toISOString().replace(/[-:.]/g, "")}`
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag))
    throw new Error("Invalid Admin image tag")
  const image = `aerpp-admin-${environment}:${tag}`
  const existing = run("docker", ["image", "ls", "--format", "json"])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .some((item) => `${item.Repository}:${item.Tag}` === image)
  if (existing) throw new Error("Admin image tag already exists")
  const output = outputDirectory(environment)
  const files = assets.map(({ name, sha256 }) => ({ name, sha256 }))
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ environment, files }))
    .digest("hex")
  console.log(
    `Building ${environment} Admin image locally for linux/amd64; output is in private admin-build.log`,
  )
  run(
    "docker",
    [
      "buildx",
      "build",
      "--load",
      "--platform",
      "linux/amd64",
      "--file",
      "apps/admin/Dockerfile",
      "--tag",
      image,
      "--label",
      "io.aerpp.component=admin",
      "--build-arg",
      `AERPP_ENVIRONMENT=${environment}`,
      "--build-arg",
      `BUILD_INPUT_SHA=${inputHash}`,
      "--build-arg",
      `SOURCE_REVISION=${revision}`,
      "--label",
      `io.aerpp.source-tree=${sourceState.sourceTree}`,
      ".",
    ],
    { log: resolve(output, "admin-build.log") },
  )
  const inspection = JSON.parse(run("docker", ["image", "inspect", image]))[0]
  if (inspection.Architecture !== "amd64" || inspection.Os !== "linux")
    throw new Error("Admin image architecture mismatch")
  assertMatchingSource(readSourceState(), sourceState)
  assertImageSource({ ...sourceState, imageId: inspection.Id }, inspection)
  privateJson(resolve(output, "admin-image.json"), {
    version: 1,
    environment,
    project: target.project,
    image,
    imageId: inspection.Id,
    platform: "linux/amd64",
    ...sourceState,
    createdAt: new Date().toISOString(),
    assets: files,
    buildInputSha256: inputHash,
  })
  console.log(
    "Admin image built; immutable image ID recorded in private admin-image.json",
  )
  maintainLocalImages(true)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = cli(() => main())
