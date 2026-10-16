import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  checkApplication,
  environmentDirectory,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import {
  outputDirectory,
  privateJson,
  readJson,
  run,
} from "../shared/delivery.mjs"
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
import { assertAuxiliaryImages } from "./web-auxiliary-images.mjs"

const temporary = mkdtempSync(resolve(tmpdir(), "aerpp-web-image-check-"))
let container
try {
  const [environment, ...extra] = process.argv.slice(2)
  assert(["test", "production"].includes(environment) && extra.length === 0)
  const { target, values } = prepareApplicationRuntime(
    environment,
    environmentDirectory(environment),
    { apps: "web" },
  )
  checkApplication("web", values.web, environment)
  const output = outputDirectory(environment)
  const manifest = readJson(resolve(output, "web-image.json"), "Web image")
  const assets = assetManifest(resolve("apps/web/assets"))
  assertCurrentBuildInputs(manifest, values.web, assets, llmPresetManifest())
  assertAuxiliaryImages(manifest.auxiliaryImages, manifest.platform)
  assertMatchingSource(manifest, readSourceState())
  const inspection = JSON.parse(
    run("docker", ["image", "inspect", manifest.imageId]),
  )[0]
  assertImageSource(manifest, inspection)
  assert.equal(inspection.Config.User, "node")
  assert.equal(inspection.Config.Labels["io.aerpp.environment"], environment)
  assert.equal(manifest.assets.source, "assets")
  assert.equal(manifest.assets.questionnaireSource, "config/common/survey")
  assert.equal(manifest.environment, environment)
  assert.deepEqual(manifest.assets.files, assets)
  const lines = Object.entries(values.web).map(([key, value]) => {
    assert(
      !/[\r\n]/.test(value),
      "Docker env-file cannot preserve multiline values",
    )
    return `${key}=${value}`
  })
  const file = resolve(temporary, "runtime.env")
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 })
  container = run("docker", [
    "run",
    "--detach",
    "--env-file",
    file,
    "--mount",
    "type=volume,destination=/tmp/aerpp-coordination",
    "--publish",
    "127.0.0.1:4330:3000",
    manifest.imageId,
  ])
  const probe = async () => {
    const assert = (await import("node:assert/strict")).default
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        ready = (await fetch("http://127.0.0.1:3000/health")).ok
      } catch {}
      if (ready) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    assert(ready)
    for (const path of ["/", "/license", "/download"]) {
      const response = await fetch(`http://127.0.0.1:3000${path}`)
      assert.equal(response.status, 200)
      const html = await response.text()
      if (path === "/") {
        const asset = html.match(/src="([^"]*\/_next\/static\/[^"]+)"/)?.[1]
        assert(asset)
        assert.equal(
          (await fetch(new URL(asset, "http://127.0.0.1:3000"))).status,
          200,
        )
      }
    }
    const response = await fetch(
      new URL("/api/participant/information", process.env.SUPPORT_API_BASE_URL),
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPPORT_API_CREDENTIAL}`,
        },
        signal: AbortSignal.timeout(15000),
      },
    )
    assert.equal(response.status, 200)
    await response.arrayBuffer()
    assert.notEqual(process.getuid(), 0)
  }
  run("docker", [
    "exec",
    container,
    "node",
    "--input-type=module",
    "-e",
    `await (${probe.toString()})()`,
  ])
  let origin
  for (const candidate of [
    "http://127.0.0.1:4330",
    "http://host.docker.internal:4330",
  ]) {
    try {
      if (
        (
          await fetch(`${candidate}/health`, {
            signal: AbortSignal.timeout(3000),
          })
        ).ok
      ) {
        origin = candidate
        break
      }
    } catch {}
  }
  assert(origin, "Published Docker port is not reachable from the browser host")
  const { chromium, expect } = await import(
    "../../apps/web/node_modules/@playwright/test/index.mjs"
  )
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(origin, { waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("button", { name: "次に進む", exact: true }),
    ).toBeVisible({ timeout: 30000 })
    assert(!(await page.locator("body").innerText()).includes("（サンプル）"))
    await page.getByRole("button", { name: "次に進む", exact: true }).click()
    await page.getByRole("button", { name: "同意画面へ進む" }).click()
    await expect(
      page.getByRole("heading", { name: "承諾書", exact: true }),
    ).toBeVisible({ timeout: 30000 })
    await expect(
      page.getByRole("button", { name: "同意する", exact: true }),
    ).toBeDisabled()
  } finally {
    await browser.close()
  }
  assertMatchingSource(readSourceState(), manifest)
  privateJson(resolve(output, "web-image-check.json"), {
    ...sourceProvenance(manifest),
    checkedAt: new Date().toISOString(),
    project: target.project,
    imageId: manifest.imageId,
    platform: manifest.platform,
    assets: manifest.assets.source,
    nonRoot: true,
    auxiliaryImages: manifest.auxiliaryImages,
    buildInputSha256: manifest.buildInputSha256,
    publicPages: true,
    staticAssets: true,
    supportInformationStatus: 200,
    mailSent: false,
    browserPreConsent: true,
    publicSampleAbsent: true,
    authenticatedBrowserLifecycle: false,
  })
  console.log(
    "Private Web image startup, private browser screens and live support access passed; no mail sent",
  )
} catch {
  console.error(
    "Web image check failed; inspect private tooling evidence. No credentials or page bodies emitted.",
  )
  process.exitCode = 1
} finally {
  try {
    if (container) run("docker", ["rm", "--force", "--volumes", container])
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
