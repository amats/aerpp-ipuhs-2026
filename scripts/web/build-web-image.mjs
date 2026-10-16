import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { decodeManualConfig } from "@aerpp/config/manual-config"
import { assertNoAppEnvFiles } from "@aerpp/config/process"
import { SURVEY_FILES } from "@aerpp/config/survey"
import {
  checkApplication,
  environmentDirectory,
  generatedEnvironmentDirectory,
  prepareApplicationRuntime,
  ROOT,
  validateTargetValues,
} from "@aerpp/config/workspace"
import {
  assertResearchAssets,
  REQUIRED_ASSETS,
} from "../../apps/web/scripts/image-inputs.mjs"
import { researchAssetsDirectory } from "../../apps/web/src/lib/research-assets.mjs"
import { maintainLocalImages } from "../maintenance/image-retention.mjs"
import { privateJson, toolEnvironment } from "../shared/delivery.mjs"
import {
  assertImageSource,
  assertMatchingSource,
  readSourceState,
} from "../shared/source-provenance.mjs"
import { readImageDocumentSet } from "./image-documents.mjs"
import { readImageQuestionnaires } from "./image-questionnaires.mjs"
import { prepareAuxiliaryImages } from "./web-auxiliary-images.mjs"

export function imageName(serverId) {
  if (
    typeof serverId !== "string" ||
    serverId.length > 128 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(serverId)
  )
    throw new Error(
      "PARTICIPANT_API_SERVER_ID must be a lowercase Docker repository name without a registry or tag",
    )
  return serverId
}

export function buildInputs(settings) {
  // Only client-visible settings are needed during compilation. Real credentials stay runtime-only.
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => key.startsWith("NEXT_PUBLIC_")),
  )
}

export function buildInputFingerprint(settings, assets, llmPresets) {
  if (Array.isArray(llmPresets) !== true || llmPresets.length === 0)
    throw new Error("Web LLM preset fingerprints missing; rebuild the image")
  return createHash("sha256")
    .update(
      JSON.stringify({ inputs: buildInputs(settings), assets, llmPresets }),
    )
    .digest("hex")
}

export function assertCurrentBuildInputs(
  manifest,
  settings,
  assets,
  llmPresets,
) {
  if (
    manifest.buildInputSha256 !==
    buildInputFingerprint(settings, assets, llmPresets)
  )
    throw new Error(
      "Web build settings, assets or LLM presets changed; rebuild and check the selected image before export",
    )
}

export function llmPresetManifest(
  directory = resolve(ROOT, "config/common/llm"),
) {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
  if (names.length === 0) throw new Error("Missing Web LLM preset files")
  return names.map((name) => {
    const file = resolve(directory, name)
    if (
      /^[a-zA-Z0-9_-]+\.json$/.test(name) !== true ||
      lstatSync(file).isFile() !== true ||
      lstatSync(file).isSymbolicLink() === true
    )
      throw new Error("Web LLM presets must be named regular JSON files")
    const bytes = readFileSync(file)
    if (bytes.length === 0) throw new Error("Empty Web LLM preset file")
    return { name, sha256: createHash("sha256").update(bytes).digest("hex") }
  })
}

export function assetManifest(
  directory,
  surveyDirectory = resolve(ROOT, "config/common/survey"),
  documentsDirectory = resolve(ROOT, "config/common/documents"),
) {
  return [
    ...REQUIRED_ASSETS.map((name) => [name, directory]),
    ...SURVEY_FILES.map((name) => [name, surveyDirectory]),
    ["version.json", documentsDirectory],
  ].map(([name, source]) => {
    const file = resolve(source, name)
    if (
      !existsSync(file) ||
      !lstatSync(file).isFile() ||
      lstatSync(file).isSymbolicLink()
    )
      throw new Error(`Missing regular asset file: ${name}`)
    const bytes = readFileSync(file)
    if (!bytes.length) throw new Error(`Empty asset file: ${name}`)
    return { name, sha256: createHash("sha256").update(bytes).digest("hex") }
  })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: toolEnvironment(),
    ...options,
  })
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed; check the private build log`)
  return result.stdout?.trim()
}

export function main(args = process.argv.slice(2)) {
  let temporary
  try {
    const [environment, tagOption, platformOption, ...extra] = args
    if (!["test", "production"].includes(environment) || extra.length)
      throw new Error(
        "Usage: web:build-image test|production [tag] [linux/arm64|linux/amd64]",
      )
    const { target, values } = prepareApplicationRuntime(
      environment,
      environmentDirectory(environment),
      { apps: "web" },
    )
    validateTargetValues(target, values)
    checkApplication("web", values.web, environment)
    assertNoAppEnvFiles(resolve(ROOT, "apps/web"))
    const name = imageName(values.web.PARTICIPANT_API_SERVER_ID)
    const other = environment === "test" ? "production" : "test"
    const otherFile = resolve(environmentDirectory(other), "config.json")
    if (existsSync(otherFile)) {
      const otherConfig = decodeManualConfig(
        JSON.parse(readFileSync(otherFile, "utf8")),
      )
      if (name === imageName(otherConfig.shared.PARTICIPANT_API_SERVER_ID))
        throw new Error(
          "Test and production must have distinct PARTICIPANT_API_SERVER_ID values",
        )
    }
    const sourceState = readSourceState()
    const revision = sourceState.sourceRevision
    const version = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ).version
    const tag =
      tagOption ??
      `${version}-${revision.slice(0, 12)}-${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z")}`
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag))
      throw new Error("Invalid Docker image tag")
    const platform =
      platformOption ??
      `linux/${run("docker", ["version", "--format", "{{.Server.Arch}}"])}`
    if (!["linux/arm64", "linux/amd64"].includes(platform))
      throw new Error("Unsupported image platform")
    const image = `${name}:${tag}`
    if (
      spawnSync("docker", ["image", "inspect", image], {
        env: toolEnvironment(),
        stdio: "ignore",
      }).status === 0
    )
      throw new Error("Image tag already exists; choose a new tag")
    const source = "assets"
    const assetsDirectory = researchAssetsDirectory(
      resolve(ROOT, "apps/web"),
      true,
    )
    assertResearchAssets(assetsDirectory)
    temporary = mkdtempSync(resolve(tmpdir(), "aerpp-web-image-"))
    const stagedAssets = resolve(temporary, "assets")
    mkdirSync(stagedAssets, { mode: 0o700 })
    for (const name of REQUIRED_ASSETS)
      copyFileSync(resolve(assetsDirectory, name), resolve(stagedAssets, name))
    const assets = assetManifest(stagedAssets)
    const llmPresets = llmPresetManifest()
    const inputs = buildInputs(values.web)
    const inputHash = buildInputFingerprint(values.web, assets, llmPresets)
    const inputFile = resolve(temporary, "build.json")
    writeFileSync(inputFile, JSON.stringify(inputs), { mode: 0o600 })
    const dockerArgs = [
      "buildx",
      "build",
      "--load",
      "--platform",
      platform,
      "--file",
      "apps/web/Dockerfile",
      "--build-context",
      `research_assets=${stagedAssets}`,
      "--tag",
      image,
      "--label",
      "io.aerpp.component=web",
      "--secret",
      `id=web_build,src=${inputFile}`,
      "--build-arg",
      `BUILD_INPUT_SHA=${inputHash}`,
      "--build-arg",
      `AERPP_ENVIRONMENT=${environment}`,
      "--build-arg",
      `SOURCE_REVISION=${revision}`,
      "--label",
      `io.aerpp.source-tree=${sourceState.sourceTree}`,
    ]
    console.log(
      `Building ${environment} Web image for ${platform}; runtime credentials are excluded`,
    )
    const auxiliaryImages = prepareAuxiliaryImages(platform)
    run("docker", [...dockerArgs, "."], { stdio: "inherit" })
    const inspection = JSON.parse(run("docker", ["image", "inspect", image]))[0]
    assertMatchingSource(readSourceState(), sourceState)
    const output = generatedEnvironmentDirectory(environment)
    mkdirSync(output, { recursive: true, mode: 0o700 })
    const manifest = {
      environment,
      image,
      imageId: inspection.Id,
      documentSet: readImageDocumentSet(inspection.Id).reference,
      questionnaires: readImageQuestionnaires(inspection.Id).map(
        ({ name, definitionId }) => ({ name, definitionId }),
      ),
      platform,
      ...sourceState,
      createdAt: new Date().toISOString(),
      assets: {
        source,
        questionnaireSource: "config/common/survey",
        files: assets,
      },
      buildInputSha256: inputHash,
      llmPresets: { source: "config/common/llm", files: llmPresets },
      auxiliaryImages,
    }
    assertImageSource(manifest, inspection)
    privateJson(resolve(output, "web-image.json"), manifest)
    console.log(
      `Built ${environment} Web image; reference and image ID saved privately in web-image.json`,
    )
    maintainLocalImages(true)
    return 0
  } catch (error) {
    console.error(error.message)
    return 1
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main()
