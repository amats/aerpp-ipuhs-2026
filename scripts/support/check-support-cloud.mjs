import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { readSupportEnvironment } from "@aerpp/config/support"
import {
  environmentDirectory,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import {
  gcloud,
  outputDirectory,
  privateJson,
  readJson,
} from "../shared/delivery.mjs"
import { sourceProvenance } from "../shared/source-provenance.mjs"

try {
  const [environment, ...extra] = process.argv.slice(2)
  assert(["test", "production"].includes(environment) && extra.length === 0)
  const { target, values } = prepareApplicationRuntime(
    environment,
    environmentDirectory(environment),
    { apps: "support" },
  )
  const runtime = readSupportEnvironment(values.support)
  const directory = outputDirectory(environment)
  const deployment = readJson(
    resolve(directory, "support-deployment.json"),
    "Prepared deployment",
  )
  assert.equal(deployment.project, target.project)
  assert.equal(
    createHash("sha256")
      .update(values.support.SUPPORT_RUNTIME_JSON)
      .digest("hex"),
    deployment.runtimeSha256,
  )
  const service = JSON.parse(
    gcloud(target.project, [
      "run",
      "services",
      "describe",
      "aerpp-support",
      `--region=${deployment.region}`,
      "--format=json",
    ]),
  )
  assert(
    service.status.conditions.some(
      (item) => item.type === "Ready" && item.status === "True",
    ),
  )
  assert.equal(
    service.status.latestCreatedRevisionName,
    service.status.latestReadyRevisionName,
  )
  assert.equal(
    service.status.traffic
      .filter((item) => item.percent > 0)
      .reduce((sum, item) => {
        assert.equal(item.revisionName, service.status.latestReadyRevisionName)
        return sum + item.percent
      }, 0),
    100,
  )
  const template = service.spec.template
  assert.equal(template.metadata?.labels?.["aerpp-component"], "support")
  assert.equal(template.metadata?.labels?.["aerpp-environment"], environment)
  assert.equal(
    template.spec.serviceAccountName,
    `aerpp-support-runtime@${target.project}.iam.gserviceaccount.com`,
  )
  const container = template.spec.containers[0]
  assert.equal(container.image, deployment.image)
  assert.equal(container.env.length, 1)
  assert.equal(container.env[0].name, "SUPPORT_RUNTIME_JSON")
  assert.equal(
    container.env[0].valueFrom.secretKeyRef.name,
    "SUPPORT_RUNTIME_JSON",
  )
  assert.equal(
    container.env[0].valueFrom.secretKeyRef.key,
    deployment.runtimeVersion,
  )
  const checks = []
  for (const [path, method, expected] of [
    ["/health", "GET", 200],
    ["/", "GET", 200],
    ["/privacy", "GET", 200],
    ["/terms", "GET", 200],
    ["/contact", "GET", 200],
    ["/email/confirm", "GET", 200],
    ["/email/confirm", "POST", runtime.admissionOpen ? 403 : 503],
    ["/api/participant/information", "GET", 401],
    ["/api/debug/reset-participation", "POST", 404],
    ["/maintenance/withdrawal-cleanup", "POST", 401],
    ["/maintenance/mail-health", "POST", 401],
    ["/unknown", "GET", 404],
  ]) {
    const response = await fetch(new URL(path, runtime.baseUrl), {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    })
    assert.equal(
      response.status,
      expected,
      `Unexpected HTTP result for ${path}`,
    )
    await response.arrayBuffer()
    checks.push({ path, method, status: response.status })
  }
  privateJson(resolve(directory, "support-cloud-check.json"), {
    _comment: "Generated selected-environment HTTP acceptance; do not edit",
    checkedAt: new Date().toISOString(),
    project: target.project,
    revision: service.status.latestReadyRevisionName,
    image: deployment.image,
    imageId: deployment.imageId,
    ...sourceProvenance(deployment),
    runtimeVersion: deployment.runtimeVersion,
    checks,
    mailSent: false,
    authenticatedDataAccessTested: false,
  })
  console.log(
    "Selected Support revision, serving traffic and 12 HTTP boundaries verified; no mail or authenticated data requests sent.",
  )
} catch {
  console.error(
    "Support cloud check failed; inspect private deployment evidence. No response bodies or credentials printed.",
  )
  process.exitCode = 1
}
