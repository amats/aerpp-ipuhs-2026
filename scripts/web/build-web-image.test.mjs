import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import { SURVEY_FILES } from "@aerpp/config/survey"
import { REQUIRED_ASSETS } from "../../apps/web/scripts/image-inputs.mjs"
import { createWorkspace } from "../checks/test-support/workspace.mjs"
import {
  assertCurrentBuildInputs,
  assetManifest,
  buildInputFingerprint,
  buildInputs,
  imageName,
  llmPresetManifest,
} from "./build-web-image.mjs"

test("server IDs define separate repositories and cannot inject registries, tags or options", () => {
  assert.equal(imageName("aerpp-test-01"), "aerpp-test-01")
  assert.equal(imageName("aerpp-production-01"), "aerpp-production-01")
  for (const value of [
    "",
    undefined,
    "UPPER",
    "server:tag",
    "registry/server",
    "--flag",
    "server\n",
    "server..name",
  ])
    assert.throws(() => imageName(value))
})

test("build inputs exclude runtime credentials and project configuration", () => {
  assert.deepEqual(
    buildInputs({
      NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: "/@example.invalid$/",
      SUPPORT_API_CREDENTIAL: "secret",
      SESSION_SEAL_PASSWORD: "private",
      SUPPORT_API_BASE_URL: "https://private.invalid",
      PARTICIPANT_API_SERVER_ID: "private-server",
    }),
    { NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: "/@example.invalid$/" },
  )
})

test("distribution assets are complete, nonempty regular files and their exact bytes are recorded", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-image-test-"))
  const surveyDirectory = resolve(directory, "config/common/survey")
  const documentsDirectory = resolve(directory, "config/common/documents")
  mkdirSync(documentsDirectory, { recursive: true })
  writeFileSync(
    resolve(documentsDirectory, "version.json"),
    '{"version":"1.0"}',
  )
  mkdirSync(surveyDirectory, { recursive: true })
  try {
    for (const name of SURVEY_FILES)
      writeFileSync(resolve(surveyDirectory, name), `synthetic ${name}`)
    for (const name of REQUIRED_ASSETS)
      writeFileSync(resolve(directory, name), `synthetic ${name}`)
    const original = assetManifest(
      directory,
      surveyDirectory,
      documentsDirectory,
    )
    assert.equal(original.length, 11)
    writeFileSync(resolve(directory, "welcome.mdx"), "changed")
    assert.notEqual(
      assetManifest(directory, surveyDirectory, documentsDirectory)[0].sha256,
      original[0].sha256,
    )
    writeFileSync(
      resolve(surveyDirectory, SURVEY_FILES[0]),
      "changed questionnaire",
    )
    assert.notEqual(
      assetManifest(directory, surveyDirectory, documentsDirectory)[8].sha256,
      original[8].sha256,
    )
    writeFileSync(
      resolve(documentsDirectory, "version.json"),
      '{"version":"2.0"}',
    )
    assert.notEqual(
      assetManifest(directory, surveyDirectory, documentsDirectory)[10].sha256,
      original[10].sha256,
    )
    writeFileSync(resolve(directory, "consent.pdf"), "")
    assert.throws(
      () => assetManifest(directory, surveyDirectory, documentsDirectory),
      /Empty/,
    )
    rmSync(resolve(directory, "consent.pdf"))
    assert.throws(
      () => assetManifest(directory, surveyDirectory, documentsDirectory),
      /Missing/,
    )
    symlinkSync(
      resolve(directory, "welcome.mdx"),
      resolve(directory, "consent.pdf"),
    )
    assert.throws(
      () => assetManifest(directory, surveyDirectory, documentsDirectory),
      /regular/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("delivery rejects changed public build inputs and operational assets while allowing runtime-only changes", () => {
  const assets = [{ name: "welcome.mdx", sha256: "a".repeat(64) }]
  const llmPresets = [{ name: "synthetic.json", sha256: "c".repeat(64) }]
  const settings = {
    NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: "/@example.invalid$/",
    SESSION_SEAL_PASSWORD: "original",
  }
  const manifest = {
    buildInputSha256: buildInputFingerprint(settings, assets, llmPresets),
  }
  assert.doesNotThrow(() =>
    assertCurrentBuildInputs(manifest, settings, assets, llmPresets),
  )
  assert.doesNotThrow(() =>
    assertCurrentBuildInputs(
      manifest,
      { ...settings, SESSION_SEAL_PASSWORD: "changed" },
      assets,
      llmPresets,
    ),
  )
  assert.throws(
    () =>
      assertCurrentBuildInputs(
        manifest,
        {
          ...settings,
          NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: "/@other.invalid$/",
        },
        assets,
        llmPresets,
      ),
    /rebuild/,
  )
  assert.throws(
    () =>
      assertCurrentBuildInputs(
        manifest,
        settings,
        [{ ...assets[0], sha256: "b".repeat(64) }],
        llmPresets,
      ),
    /rebuild/,
  )
  assert.throws(
    () => assertCurrentBuildInputs({}, settings, assets, llmPresets),
    /rebuild/,
  )
})

test("image checks reject same-filename preset changes, additions and removals", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-llm-image-test-"))
  const preset = resolve(directory, "synthetic.json")
  const extra = resolve(directory, "another.json")
  const settings = { LLM_PRESET_FILE: "synthetic.json" }
  const assets = [{ name: "welcome.mdx", sha256: "a".repeat(64) }]
  const originalBytes = JSON.stringify({ testMarker: "original" })
  try {
    writeFileSync(preset, originalBytes)
    const presets = llmPresetManifest(directory)
    const manifest = {
      buildInputSha256: buildInputFingerprint(settings, assets, presets),
    }
    const check = () =>
      assertCurrentBuildInputs(
        manifest,
        settings,
        assets,
        llmPresetManifest(directory),
      )
    assert.doesNotThrow(check)
    writeFileSync(preset, JSON.stringify({ testMarker: "changed" }))
    assert.throws(check, /LLM presets changed/)
    writeFileSync(preset, originalBytes)
    writeFileSync(extra, "{}")
    assert.deepEqual(
      llmPresetManifest(directory).map(({ name }) => name),
      ["another.json", "synthetic.json"],
    )
    assert.throws(check, /rebuild/)
    rmSync(extra)
    assert.doesNotThrow(check)
    writeFileSync(extra, "{}")
    const twoPresetManifest = {
      buildInputSha256: buildInputFingerprint(
        settings,
        assets,
        llmPresetManifest(directory),
      ),
    }
    assert.doesNotThrow(() =>
      assertCurrentBuildInputs(
        twoPresetManifest,
        { ...settings, LLM_PRESET_FILE: "another.json" },
        assets,
        llmPresetManifest(directory),
      ),
    )
    rmSync(extra)
    assert.throws(
      () =>
        assertCurrentBuildInputs(
          twoPresetManifest,
          settings,
          assets,
          llmPresetManifest(directory),
        ),
      /rebuild/,
    )
    assert.throws(() => buildInputFingerprint(settings, assets), /rebuild/)
    writeFileSync(preset, "")
    assert.throws(check, /Empty/)
    rmSync(preset)
    assert.throws(check, /Missing/)
    writeFileSync(extra, "{}")
    symlinkSync(extra, preset)
    assert.throws(check, /regular/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("Web image preparation isolates Git and Docker children from ambient application credentials", (t) => {
  const { root, write } = createWorkspace(t, "aerpp-web-build-isolation-")
  const callsFile = resolve(root, "calls.jsonl")
  const keys = [
    "SESSION_SEAL_PASSWORD",
    "SUPPORT_API_CREDENTIAL",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCLOUD_PROJECT",
  ]
  for (const command of ["git", "docker"]) {
    write(
      `bin/${command}`,
      `#!${process.execPath}
const fs = require("node:fs")
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ command: ${JSON.stringify(command)}, env: Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key]])) }) + "\\n")
if (${JSON.stringify(command)} === "git" && process.argv[2] === "rev-parse") process.stdout.write("a".repeat(40))
`,
    )
    chmodSync(resolve(root, "bin", command), 0o700)
  }
  const workspace = import.meta.resolve("@aerpp/config/workspace")
  write(
    "preload.mjs",
    `
import { registerHooks } from "node:module"
registerHooks({ load(url, context, next) {
  if (url === ${JSON.stringify(workspace)}) return { format: "module", shortCircuit: true, source: ${JSON.stringify(`
    export * from ${JSON.stringify(`${workspace}?original`)}
    export function environmentDirectory(name) { return ${JSON.stringify(root)} + "/" + name }
    export function prepareApplicationRuntime() { return { target: { name: "test", project: "synthetic-test" }, values: { web: { PARTICIPANT_API_SERVER_ID: "synthetic-web" } } } }
    export function validateTargetValues() {}
    export function checkApplication() {}
  `)} }
  return next(url, context)
} })
`,
  )
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve(root, "preload.mjs")).href,
      fileURLToPath(new URL("./build-web-image.mjs", import.meta.url)),
      "test",
      "synthetic-existing",
      "linux/amd64",
    ],
    {
      cwd: root,
      env: applicationEnvironment({
        PATH: `${resolve(root, "bin")}:${process.env.PATH}`,
        ...Object.fromEntries(
          keys.map((key) => [key, "synthetic-ambient-value"]),
        ),
      }),
      encoding: "utf8",
      timeout: 10_000,
    },
  )
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Image tag already exists/)
  const calls = readFileSync(callsFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    calls.map((call) => call.command),
    ["git", "git", "git", "docker"],
  )
  for (const call of calls)
    for (const key of keys)
      assert.equal(call.env[key], "", `${call.command} inherited ${key}`)
})
