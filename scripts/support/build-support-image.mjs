import { resolve } from "node:path"
import { maintainLocalImages } from "../maintenance/image-retention.mjs"
import { cli, outputDirectory, privateJson, run } from "../shared/delivery.mjs"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
} from "../shared/source-provenance.mjs"

process.exitCode = cli(() => {
  const [environment, ...extra] = process.argv.slice(2)
  if (!["test", "production"].includes(environment) || extra.length)
    throw new Error("Usage: support:build-image test|production")
  const sourceState = readSourceState()
  const directory = outputDirectory(environment)
  const tag = `aerpp-support:${environment}-local`
  run(
    "docker",
    [
      "buildx",
      "build",
      "--platform",
      "linux/amd64",
      "--load",
      "--file",
      "apps/support/Dockerfile",
      "--tag",
      tag,
      "--label",
      "io.aerpp.component=support",
      "--label",
      `io.aerpp.environment=${environment}`,
      "--label",
      `org.opencontainers.image.revision=${sourceState.sourceRevision}`,
      "--label",
      `io.aerpp.source-tree=${sourceState.sourceTree}`,
      ".",
    ],
    { log: resolve(directory, "support-build.log") },
  )
  const image = JSON.parse(run("docker", ["image", "inspect", tag]))[0]
  if (
    image.Os !== "linux" ||
    image.Architecture !== "amd64" ||
    image.Config.User !== "node"
  )
    throw new Error("Unexpected support image platform/user")
  assertMatchingSource(readSourceState(), sourceState)
  assertImageSource({ ...sourceState, imageId: image.Id }, image)
  privateJson(resolve(directory, "support-image.json"), {
    _comment: "Generated local image evidence; do not edit",
    environment,
    tag,
    imageId: image.Id,
    platform: "linux/amd64",
    ...sourceState,
    createdAt: new Date().toISOString(),
  })
  console.log(
    "Support image built locally; private image evidence recorded. No cloud deployment performed.",
  )
  maintainLocalImages(true)
})
