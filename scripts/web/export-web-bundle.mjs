import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import { environmentTarget } from "@aerpp/config/targets"
import { ROOT } from "@aerpp/config/workspace"
import { acquireBundleLock } from "../maintenance/bundle-retention.mjs"
import { outputDirectory, privateJson, run } from "../shared/delivery.mjs"
import { runtimeFingerprint } from "../shared/runtime-fingerprint.mjs"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
  sourceProvenance,
} from "../shared/source-provenance.mjs"
import {
  assertCurrentBuildInputs,
  assetManifest,
  llmPresetManifest,
} from "./build-web-image.mjs"
import { exportBundleImages } from "./bundle-images.mjs"
import { generateWebCompose } from "./generate-compose.mjs"
import { assertDocumentRegistration } from "./prepare-documents.mjs"
import { assertQuestionnaireRegistration } from "./prepare-questionnaires.mjs"
import { assertAuxiliaryImages } from "./web-auxiliary-images.mjs"

let unlock
try {
  const [environment, ...extra] = process.argv.slice(2)
  assert(["test", "production"].includes(environment) && extra.length === 0)
  const output = outputDirectory(environment)
  unlock = acquireBundleLock(output)
  const image = JSON.parse(readFileSync(resolve(output, "web-image.json")))
  const checked = JSON.parse(
    readFileSync(resolve(output, "web-image-check.json")),
  )
  assertQuestionnaireRegistration(
    JSON.parse(
      readFileSync(resolve(output, "web-questionnaires.json"), "utf8"),
    ),
    image,
    environmentTarget(environment).project,
  )
  assertDocumentRegistration(
    JSON.parse(readFileSync(resolve(output, "web-documents.json"), "utf8")),
    image,
    environmentTarget(environment).project,
  )
  assertMatchingSource(image, readSourceState())
  assertMatchingSource(checked, image)
  assert.equal(image.environment, environment)
  assert.equal(image.platform, "linux/arm64")
  assert.equal(checked.imageId, image.imageId)
  assert.equal(checked.publicPages, true)
  assert.equal(checked.buildInputSha256, image.buildInputSha256)
  assertAuxiliaryImages(image.auxiliaryImages, image.platform)
  assert.deepEqual(checked.auxiliaryImages, image.auxiliaryImages)
  const images = [
    ["app-aerpp", image.imageId],
    ...image.auxiliaryImages.images.map((item) => [item.service, item.id]),
  ].map(([service, reference]) => {
    const inspected = JSON.parse(
      run("docker", ["image", "inspect", reference]),
    )[0]
    if (service === "app-aerpp") assertImageSource(image, inspected)
    assert.equal(`${inspected.Os}/${inspected.Architecture}`, image.platform)
    assert.match(inspected.Id, /^sha256:[a-f0-9]{64}$/)
    return { service, id: inspected.Id, platform: image.platform }
  })
  const releaseId = `${environment}-${Date.now()}-${image.imageId.slice(7, 19)}`
  const destination = resolve(output, "bundles", releaseId)
  generateWebCompose(environment, image.imageId)
  const runtime = JSON.parse(readFileSync(resolve(output, "compose.json")))
  const settings = Object.fromEntries(
    Object.entries(runtime.services["app-aerpp"].environment).map(
      ([key, value]) => [key, value.replaceAll("$$", "$")],
    ),
  )
  assertCurrentBuildInputs(
    image,
    settings,
    assetManifest(resolve("apps/web/assets")),
    llmPresetManifest(),
  )
  mkdirSync(resolve(destination, "config"), { recursive: true, mode: 0o700 })
  exportBundleImages(images, releaseId, destination)
  const credentials = runtime.services["fluent-bit"].volumes.find(
    (v) => v.target === "/fluent-bit/etc/gcp-credentials.json",
  )
  copyFileSync(
    credentials.source.replaceAll("$$", "$"),
    resolve(destination, "config/logging-credentials.json"),
  )
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Docker Compose expands this placeholder on the installation host.
  credentials.source = "${AERPP_CONFIG_DIR}/logging-credentials.json"
  const llmFile = runtime.services["app-aerpp"].environment.LLM_PRESET_FILE
  assert.match(
    llmFile,
    /^(?:\.\.\/\.\.\/config\/common\/llm\/)?[a-zA-Z0-9_-]+\.json$/,
  )
  const probe = run("docker", ["create", "--pull", "never", image.imageId])
  try {
    run("docker", [
      "cp",
      `${probe}:/app/config/common/llm/${llmFile.split("/").at(-1)}`,
      resolve(destination, "llm-config.json"),
    ])
  } finally {
    run("docker", ["rm", "-f", probe])
  }
  copyFileSync(
    resolve("infra/check-local-llm.mjs"),
    resolve(destination, "check-local-llm.mjs"),
  )
  delete runtime.services["app-aerpp"].image
  privateJson(resolve(destination, "config/runtime.json"), runtime)
  writeFileSync(
    resolve(destination, "config/profile.txt"),
    `${environment}\n`,
    { mode: 0o600 },
  )
  privateJson(resolve(destination, "images.json"), {
    services: Object.fromEntries(
      images.map((i) => [
        i.service,
        { image: i.reference, pull_policy: "never" },
      ]),
    ),
  })
  writeFileSync(
    resolve(destination, "images.txt"),
    `${images
      .map(
        (i) =>
          `${i.service} ${i.reference} ${i.platform} ${i.id} ${i.configId}`,
      )
      .join("\n")}\n`,
    { mode: 0o600 },
  )
  for (const file of [
    "compose.yaml",
    "Caddyfile",
    "fluent-bit.conf",
    "parsers.conf",
  ])
    copyFileSync(resolve("infra", file), resolve(destination, file))
  copyFileSync(
    resolve("infra/BUNDLE-README.md"),
    resolve(destination, "README.md"),
  )
  copyFileSync(
    resolve("infra/operate-bundle.sh"),
    resolve(destination, "operate.sh"),
  )
  chmodSync(resolve(destination, "operate.sh"), 0o700)
  copyFileSync(resolve("infra/install.sh"), resolve(destination, "install.sh"))
  chmodSync(resolve(destination, "install.sh"), 0o700)
  chmodSync(resolve(destination, "config/logging-credentials.json"), 0o600)
  writeFileSync(resolve(destination, "release-id.txt"), `${releaseId}\n`, {
    mode: 0o600,
  })
  privateJson(resolve(destination, "release.json"), {
    releaseId,
    createdAt: new Date().toISOString(),
    environment,
    ...sourceProvenance(image),
    buildInputSha256: image.buildInputSha256,
    images,
    operationalHardwareTest: "not performed by bundle export",
  })
  const files = [
    "README.md",
    "check-local-llm.mjs",
    "llm-config.json",
    "images.tar",
    "release.json",
    "release-id.txt",
    "images.json",
    "images.txt",
    "compose.yaml",
    "Caddyfile",
    "fluent-bit.conf",
    "parsers.conf",
    "operate.sh",
    "install.sh",
    "config/runtime.json",
    "config/profile.txt",
    "config/logging-credentials.json",
  ]
  const checksums = []
  for (const file of files) {
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(resolve(destination, file)))
      hash.update(chunk)
    checksums.push(`${hash.digest("hex")}  ${file}`)
  }
  writeFileSync(
    resolve(destination, "SHA256SUMS"),
    `${checksums.join("\n")}\n`,
    { mode: 0o600 },
  )
  const distributions = resolve(ROOT, "distribution", environment)
  mkdirSync(distributions, { recursive: true, mode: 0o700 })
  const zipPath = resolve(distributions, `${releaseId}.zip`)
  const temporaryZip = resolve(distributions, `.${releaseId}.partial.zip`)
  run("zip", ["-q", "-r", "-1", temporaryZip, releaseId], {
    cwd: resolve(output, "bundles"),
  })
  chmodSync(temporaryZip, 0o600)
  run("zip", ["-T", temporaryZip])
  renameSync(temporaryZip, zipPath)
  const zipHash = createHash("sha256")
  for await (const chunk of createReadStream(zipPath)) zipHash.update(chunk)
  const zipSha256 = zipHash.digest("hex")
  writeFileSync(`${zipPath}.sha256`, `${zipSha256}  ${releaseId}.zip\n`, {
    mode: 0o600,
  })
  assertMatchingSource(readSourceState(), image)
  privateJson(resolve(output, "web-bundle.json"), {
    ...sourceProvenance(image),
    destination,
    releaseId,
    zipPath,
    zipSha256,
    exportedAt: new Date().toISOString(),
    imageId: image.imageId,
    platform: image.platform,
    containsPrivateConfiguration: true,
    runtimeSha256: runtimeFingerprint(settings),
    buildInputSha256: image.buildInputSha256,
  })
  console.log(
    "Private immutable ARM64 bundle exported with image IDs and checksums; runtime configuration is separate from release images. No upload or operational deployment performed.",
  )
} catch {
  console.error(
    "Private bundle export incomplete; inspect local image acceptance and selected logging configuration. No sensitive values emitted.",
  )
  process.exitCode = 1
} finally {
  unlock?.()
}
