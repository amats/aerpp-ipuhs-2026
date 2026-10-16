import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { hostedAdminEnvironment } from "@aerpp/config/admin-deployment"
import { readSupportEnvironment } from "@aerpp/config/support"
import {
  checkEnvironment,
  environmentDirectory,
  prepareApplicationRuntime,
  ROOT,
} from "@aerpp/config/workspace"
import { outputDirectory, readJson } from "../shared/delivery.mjs"
import { runtimeFingerprint } from "../shared/runtime-fingerprint.mjs"
import {
  assertMatchingSource,
  readSourceState,
} from "../shared/source-provenance.mjs"
import { assertMailAdmission } from "../support/support-update-policy.mjs"
import {
  assertCurrentBuildInputs,
  assetManifest,
  llmPresetManifest,
} from "../web/build-web-image.mjs"

export function assertReleaseEvidence(
  project,
  values,
  evidence,
  webInputs,
  sourceState,
) {
  for (const key of [
    "support",
    "cloud",
    "admin",
    "adminCheck",
    "web",
    "webCheck",
    "bundle",
  ]) {
    assertMatchingSource(evidence[key], sourceState)
    assert.match(evidence[key].imageId ?? "", /^sha256:[a-f0-9]{64}$/)
  }
  const runtime = readSupportEnvironment(values.support)
  assert.equal(runtime.environment, "production")
  assert.equal(runtime.projectId, project)
  assert.equal(
    runtime.admissionOpen,
    true,
    "Production admission is not accepted",
  )
  const {
    support,
    cloud,
    admission,
    admin,
    adminCheck,
    web,
    webCheck,
    bundle,
  } = evidence
  assert.equal(support.project, project)
  assert.equal(
    support.runtimeSha256,
    createHash("sha256")
      .update(values.support.SUPPORT_RUNTIME_JSON)
      .digest("hex"),
  )
  assert.equal(cloud.project, project)
  assert.equal(cloud.image, support.image)
  assert.equal(cloud.imageId, support.imageId)
  assert.equal(cloud.runtimeVersion, support.runtimeVersion)
  assert.equal(typeof cloud.revision, "string")
  assert.equal(cloud.checks?.length, 12)
  assertMailAdmission(runtime, admission, support.image)
  assert.equal(admin.environment, "production")
  assert.equal(admin.project, project)
  const hostedAdmin = hostedAdminEnvironment(
    values.admin,
    admin.url,
    "production",
  )
  assert.equal(
    admin.runtimeSha256,
    runtimeFingerprint({ ...hostedAdmin.runtime, ...hostedAdmin.secrets }),
    "Admin settings changed or fingerprint missing; prepare and accept the current deployment",
  )
  assert.equal(adminCheck.project, project)
  assert.equal(adminCheck.revision, admin.revision)
  assert.equal(adminCheck.image, admin.digestImage)
  assert.equal(adminCheck.imageId, admin.imageId)
  assert.equal(adminCheck.ok, true)
  assert.equal(web.environment, "production")
  assertCurrentBuildInputs(
    web,
    values.web,
    webInputs.assets,
    webInputs.llmPresets,
  )
  assert.equal(webCheck.imageId, web.imageId)
  assert.equal(webCheck.buildInputSha256, web.buildInputSha256)
  assert.equal(webCheck.publicPages, true)
  assert.equal(bundle.imageId, web.imageId)
  assert.equal(bundle.buildInputSha256, web.buildInputSha256)
  assert.equal(
    bundle.runtimeSha256,
    runtimeFingerprint(values.web),
    "Web settings changed or fingerprint missing; check and export the current bundle",
  )
  assert.equal(bundle.containsPrivateConfiguration, true)
}

export function main() {
  const environment = "production"
  const directory = environmentDirectory(environment)
  checkEnvironment(environment, directory)
  const config = JSON.parse(readFileSync(resolve(directory, "config.json")))
  assert.match(
    config.infrastructure.operatorAccount,
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  )
  const { target, values } = prepareApplicationRuntime(environment, directory)
  const output = outputDirectory(environment)
  const evidence = Object.fromEntries(
    Object.entries({
      support: "support-deployment",
      cloud: "support-cloud-check",
      admission: "support-mail-admission-baseline",
      admin: "admin-deployed",
      adminCheck: "admin-cloud-check",
      web: "web-image",
      webCheck: "web-image-check",
      bundle: "web-bundle",
    }).map(([key, file]) => [
      key,
      readJson(resolve(output, `${file}.json`), `Production ${key} evidence`),
    ]),
  )
  const sourceState = readSourceState()
  assertReleaseEvidence(
    target.project,
    values,
    evidence,
    {
      assets: assetManifest(resolve(ROOT, "apps/web/assets")),
      llmPresets: llmPresetManifest(),
    },
    sourceState,
  )
  assertMatchingSource(readSourceState(), sourceState)
  console.log(
    "Production configuration and matching recorded delivery evidence passed. Reconfirm live OAuth, mail and operational-host acceptance before release.",
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main()
  } catch {
    console.error(
      "Production release is not ready: complete the independent production settings and matching deployment acceptance. No cloud changes performed.",
    )
    process.exitCode = 1
  }
}
