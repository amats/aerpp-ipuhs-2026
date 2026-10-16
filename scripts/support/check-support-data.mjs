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

try {
  const [environment, ...extra] = process.argv.slice(2)
  assert(["test", "production"].includes(environment) && extra.length === 0)
  const directory = environmentDirectory(environment)
  const { target, values } = prepareApplicationRuntime(environment, directory, {
    apps: "support",
  })
  const runtime = readSupportEnvironment(values.support)
  assert.equal(runtime.admissionOpen, false)
  const deployment = readJson(
    resolve(outputDirectory(environment), "support-deployment.json"),
    "Prepared runtime",
  )
  assert.equal(deployment.project, target.project)
  assert.equal(
    createHash("sha256")
      .update(values.support.SUPPORT_RUNTIME_JSON)
      .digest("hex"),
    deployment.runtimeSha256,
  )
  const credential = readJson(
    resolve(directory, "secret.json"),
    "Private secret store",
  ).SUPPORT_WEB_API_CREDENTIAL
  assert.equal(typeof credential, "string")
  const [id, secret] = credential.split(".")
  const caller = runtime.credentials.find((entry) => entry.id === id)
  assert(
    caller &&
      !caller.revoked &&
      caller.notBeforeMs <= Date.now() &&
      caller.expiresAtMs > Date.now(),
  )
  assert.equal(
    createHash("sha256").update(secret).digest("hex"),
    caller.verifierHash,
  )
  const fields = JSON.parse(
    gcloud(target.project, [
      "firestore",
      "indexes",
      "fields",
      "list",
      "--database=(default)",
      "--collection-group=supportRateLimits",
      "--format=json",
    ]),
  )
  const ttl = fields.find((field) => field.name.endsWith("/fields/expireAt"))
  assert.equal(ttl?.ttlConfig?.state, "ACTIVE")
  assert.equal(ttl.indexConfig?.indexes?.length ?? 0, 0)
  const checks = []
  for (const [path, method, body, expected] of [
    ["/api/participant/information", "GET", undefined, 200],
    [
      "/api/participant/send-magic-link",
      "POST",
      { serverId: caller.serverId },
      503,
    ],
    [
      "/api/participant/analysis-attempt",
      "POST",
      { serverId: `${caller.serverId}-wrong` },
      403,
    ],
  ]) {
    const response = await fetch(new URL(path, runtime.baseUrl), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    assert.equal(response.status, expected)
    await response.arrayBuffer()
    checks.push({ path, status: response.status })
  }
  privateJson(
    resolve(outputDirectory(environment), "support-data-check.json"),
    {
      _comment: "Generated closed-service data acceptance; do not edit",
      checkedAt: new Date().toISOString(),
      project: target.project,
      runtimeSha256: deployment.runtimeSha256,
      ttlActive: true,
      checks,
      rateLimitCountersWritten: true,
      participantWritesRequested: false,
      mailSent: false,
    },
  )
  console.log(
    "Closed support data checks passed: TTL active, authorized read, admission closure and server identity rejection. Only rate-limit counters written; no mail sent.",
  )
} catch {
  console.error(
    "Support data check failed; review private infrastructure evidence. No secret or response details emitted.",
  )
  process.exitCode = 1
}
