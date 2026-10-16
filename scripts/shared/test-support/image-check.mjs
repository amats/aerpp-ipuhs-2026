import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import { SURVEY_FILES } from "@aerpp/config/survey"
import { REQUIRED_ASSETS } from "../../../apps/web/scripts/image-inputs.mjs"
import { createWorkspace } from "../../checks/test-support/workspace.mjs"

export function assertImageCheckCleanup(t, component) {
  for (const cleanupFails of [false, true]) {
    const { root, write } = createWorkspace(t, `aerpp-${component}-cleanup-`)
    const temporary = join(root, "temporary")
    mkdirSync(temporary)
    const callsFile = join(root, "calls.jsonl")
    const delivery = new URL("../delivery.mjs", import.meta.url).href
    const workspace = import.meta.resolve("@aerpp/config/workspace")
    const targets = import.meta.resolve("@aerpp/config/targets")
    const assets = [...REQUIRED_ASSETS, ...SURVEY_FILES, "version.json"].map(
      (name) => ({ name, sha256: "a".repeat(64) }),
    )
    const sourceModule = new URL("../source-provenance.mjs", import.meta.url)
      .href
    const mocks = [
      [
        sourceModule,
        `export * from ${JSON.stringify(`${sourceModule}?original`)}; export function readSourceState() { return { sourceRevision: "a".repeat(40), sourceTree: "b".repeat(40), sourceDirty: false } }`,
      ],
      [
        delivery,
        `
        export * from ${JSON.stringify(`${delivery}?original`)}
        import assert from "node:assert/strict"
        import { appendFileSync, readFileSync } from "node:fs"
        const record = (value) => appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(value) + "\\n")
        const imageId = "sha256:" + "a".repeat(64)
        let environmentFile
        export function run(command, args) {
          assert.equal(command, "docker")
          record(args)
          if (args[0] === "image" && args[1] === "inspect") return JSON.stringify([{
            Id: imageId, Architecture: "amd64", Os: "linux",
            Config: { User: "node", Labels: { "io.aerpp.environment": "test", "org.opencontainers.image.revision": "a".repeat(40), "io.aerpp.source-tree": "b".repeat(40) } },
          }])
          if (args[0] === "run") {
            environmentFile = args[args.indexOf("--env-file") + 1]
            assert.match(readFileSync(environmentFile, "utf8"), /synthetic/)
            return "b".repeat(64)
          }
          if (args[0] === "exec") throw new Error("synthetic probe failure")
          assert.equal(args[0], "rm")
          assert.match(readFileSync(environmentFile, "utf8"), /synthetic/)
          if (${cleanupFails}) throw new Error("synthetic container removal failure")
          return ""
        }
        export function readJson() { return {
          version: 1, environment: "test", project: "synthetic-test", imageId,
          sourceRevision: "a".repeat(40), sourceTree: "b".repeat(40), sourceDirty: false,
          platform: "linux/amd64", buildInputSha256: "synthetic",
          assets: { source: "assets", questionnaireSource: "config/common/survey", files: ${JSON.stringify(assets)} },
        } }
        export function outputDirectory() { return ${JSON.stringify(root)} }
        export function privateJson() { throw new Error("Failed probe must not write acceptance") }
        export function gcloud() { throw new Error("Unexpected cloud request") }
      `,
      ],
      [
        workspace,
        `
        export * from ${JSON.stringify(`${workspace}?original`)}
        export function prepareApplicationRuntime() {
          return { target: { name: "test", project: "synthetic-test" }, values: { web: { SESSION_SEAL_PASSWORD: "synthetic-runtime-secret" } } }
        }
        export function checkApplication() {}
      `,
      ],
      [
        targets,
        `
        export * from ${JSON.stringify(`${targets}?original`)}
        export function environmentTarget() { return { name: "test", project: "synthetic-test" } }
      `,
      ],
      [
        new URL("../../web/build-web-image.mjs", import.meta.url).href,
        `
        export function assertCurrentBuildInputs() {}
        export function assetManifest() { return ${JSON.stringify(assets)} }
        export function llmPresetManifest() { return [] }
      `,
      ],
      [
        new URL("../../web/web-auxiliary-images.mjs", import.meta.url).href,
        `
        export function assertAuxiliaryImages() {}
      `,
      ],
    ]
    write(
      "preload.mjs",
      `
      import { registerHooks } from "node:module"
      const mocks = new Map(${JSON.stringify(mocks)})
      registerHooks({ load(url, context, next) {
        if (mocks.has(url)) return { format: "module", source: mocks.get(url), shortCircuit: true }
        return next(url, context)
      } })
      globalThis.fetch = () => { throw new Error("Unexpected network request") }
    `,
    )
    const entrypoint = fileURLToPath(
      new URL(
        `../../${component}/check-${component}-image.mjs`,
        import.meta.url,
      ),
    )
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(join(root, "preload.mjs")).href,
        entrypoint,
        "test",
      ],
      {
        cwd: root,
        env: applicationEnvironment({ TMPDIR: temporary }),
        encoding: "utf8",
        timeout: 10_000,
      },
    )
    assert.equal(result.status, 1, result.stderr)
    const calls = readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert(
      calls.some((args) => args[0] === "exec"),
      result.stderr,
    )
    assert.equal(calls.at(-1)[0], "rm")
    assert.deepEqual(
      readdirSync(temporary),
      [],
      `${component}: temporary runtime settings remain after cleanupFails=${cleanupFails}`,
    )
  }
}
