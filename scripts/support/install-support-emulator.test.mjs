import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import { createWorkspace } from "../checks/test-support/workspace.mjs"
import { FIRESTORE_EMULATOR_VERSION } from "./install-support-emulator.mjs"

const scenarios = [
  ...["checksum", "http", "body", "existing"].map((scenario) => ({ scenario })),
  ...[false, undefined, null, "false", 1, {}, []].map((responseOk, index) => ({
    scenario: `invalid boolean ${index}`,
    responseOk,
  })),
]

for (const { scenario, responseOk } of scenarios) {
  test(`emulator installation preserves local state after ${scenario} failure`, (t) => {
    const { root, write } = createWorkspace(t, "aerpp-emulator-install-")
    const installation = join(root, "installation")
    mkdirSync(installation)
    const name = `cloud-firestore-emulator-v${FIRESTORE_EMULATOR_VERSION}.jar`
    if (scenario === "existing")
      write(`installation/${name}`, "retained installation")
    const calls = join(root, "requests.jsonl")
    const entrypoint = new URL(
      "./install-support-emulator.mjs",
      import.meta.url,
    )
    const preload = join(root, "preload.mjs")
    write(
      "preload.mjs",
      `
        import { registerHooks } from "node:module"
        import { appendFileSync } from "node:fs"
        const source = \`export * from "node:url"
              import { fileURLToPath as original } from "node:url"
              export function fileURLToPath(value, ...rest) {
                return String(value).endsWith("/private/tools/firestore/")
                  ? ${JSON.stringify(installation)} : original(value, ...rest)
              }\`
        registerHooks({ resolve(specifier, context, next) {
          if (specifier === "node:url" && context.parentURL === ${JSON.stringify(entrypoint.href)}) return {
            shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(source),
          }
          return next(specifier, context)
        } })
        globalThis.fetch = async (url) => {
          appendFileSync(${JSON.stringify(calls)}, String(url) + "\\n")
          if (${JSON.stringify(scenario)} === "existing") throw new Error("Unexpected download")
          if (${JSON.stringify(scenario)} === "http") return new Response(null, { status: 503 })
          if (${JSON.stringify(scenario)}.startsWith("invalid boolean")) return {
            ok: ${JSON.stringify(responseOk)},
            arrayBuffer: async () => { throw new Error("Invalid success must not read the body") },
          }
          if (${JSON.stringify(scenario)} === "body") return {
            ok: true, arrayBuffer: async () => { throw new Error("Synthetic interrupted download") },
          }
          return new Response("synthetic corrupt download")
        }
      `,
    )
    const result = spawnSync(
      process.execPath,
      ["--import", preload, fileURLToPath(entrypoint)],
      {
        cwd: root,
        env: applicationEnvironment({}),
        encoding: "utf8",
        timeout: 10_000,
      },
    )
    assert.equal(result.status, 1, result.stderr)
    assert.doesNotMatch(result.stdout, /checksum verified/)
    assert.match(
      result.stderr,
      scenario === "http" || scenario.startsWith("invalid boolean")
        ? /download failed/
        : scenario === "body"
          ? /interrupted download/
          : /checksum mismatch/,
    )
    assert.deepEqual(
      readdirSync(installation),
      scenario === "existing" ? [name] : [],
    )
    if (scenario === "existing") {
      assert.equal(
        readFileSync(join(installation, name), "utf8"),
        "retained installation",
      )
      assert.equal(existsSync(calls), false)
    } else {
      assert.equal(
        readFileSync(calls, "utf8").trim(),
        `https://storage.googleapis.com/firebase-preview-drop/emulator/${name}`,
      )
    }
  })
}
