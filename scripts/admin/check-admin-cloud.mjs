import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { environmentTarget } from "@aerpp/config/targets"
import {
  gcloud,
  outputDirectory,
  privateJson,
  readJson,
} from "../shared/delivery.mjs"
import { sourceProvenance } from "../shared/source-provenance.mjs"
import { checkHttp } from "./check-admin-image.mjs"

export function checkRevision(revision, deployed) {
  assert.equal(revision.metadata?.labels?.["aerpp-component"], "admin")
  assert.equal(
    revision.metadata?.labels?.["aerpp-environment"],
    deployed.environment,
  )
  assert.equal(revision.status?.imageDigest, deployed.digestImage)
  assert.equal(revision.spec?.serviceAccountName, deployed.serviceAccount)
  const env = Object.fromEntries(
    (revision.spec?.containers?.[0]?.env ?? []).map((entry) => [
      entry.name,
      entry,
    ]),
  )
  for (const key of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCP_SERVICE_ACCOUNT_PRIVATE_KEY",
    "GCP_SERVICE_ACCOUNT_EMAIL",
  ])
    assert.equal(env[key], undefined)
  for (const [key, value] of Object.entries(deployed.runtime))
    assert.equal(env[key]?.value, value, `Runtime setting mismatch: ${key}`)
  for (const [key, value] of Object.entries(deployed.versions)) {
    const [name, version] = value.split(":")
    assert.equal(env[key]?.value, undefined)
    assert.deepEqual(env[key]?.valueFrom?.secretKeyRef, { name, key: version })
  }
}

export async function main(args = process.argv.slice(2)) {
  const [environment] = args
  if (args.length !== 1 || !["test", "production"].includes(environment))
    throw new Error("Usage: admin:check-cloud test|production")
  const { project } = environmentTarget(environment)
  const output = outputDirectory(environment)
  const deployed = readJson(
    resolve(output, "admin-deployed.json"),
    "Admin deployed manifest",
  )
  if (deployed.project !== project || deployed.environment !== environment)
    throw new Error("Admin deployed target mismatch")
  const service = JSON.parse(
    gcloud(project, [
      "run",
      "services",
      "describe",
      deployed.deployment.service,
      `--region=${deployed.deployment.region}`,
      "--format=json",
    ]),
  )
  assert(
    service.status?.traffic?.some(
      (t) => t.revisionName === deployed.revision && t.percent === 100,
    ),
    "Checked revision must receive all service traffic",
  )
  const revision = JSON.parse(
    gcloud(project, [
      "run",
      "revisions",
      "describe",
      deployed.revision,
      `--region=${deployed.deployment.region}`,
      "--format=json",
    ]),
  )
  checkRevision(revision, deployed)
  await checkHttp(deployed.url)
  const csrfResponse = await fetch(`${deployed.url}/api/auth/csrf`, {
    signal: AbortSignal.timeout(15000),
  })
  const csrf = (await csrfResponse.json()).csrfToken
  const cookies = csrfResponse.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  const response = await fetch(`${deployed.url}/api/auth/signin/google`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookies,
      origin: deployed.url,
    },
    body: new URLSearchParams({
      csrfToken: csrf,
      callbackUrl: `${deployed.url}/dashboard`,
      json: "true",
    }),
  })
  assert.equal(response.status, 200)
  const authorize = new URL((await response.json()).url)
  assert.equal(authorize.hostname, "accounts.google.com")
  assert.equal(
    authorize.searchParams.get("client_id"),
    deployed.runtime.ADMIN_GOOGLE_OAUTH_CLIENT_ID,
  )
  assert.equal(authorize.searchParams.get("redirect_uri"), deployed.callbackUrl)
  assert(authorize.searchParams.get("state"))
  privateJson(resolve(output, "admin-cloud-check.json"), {
    environment,
    project,
    revision: deployed.revision,
    image: deployed.digestImage,
    imageId: deployed.imageId,
    ...sourceProvenance(deployed),
    ok: true,
    checkedAt: new Date().toISOString(),
    scope:
      "deployed image identity, anonymous routes, CSRF and Google authorization redirect; actual Google login and cloud data access excluded",
  })
  console.log(
    "Selected Admin cloud HTTP/OAuth redirect checks passed; complete Google login and data access in the browser",
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main()
  } catch {
    console.error(
      "Admin cloud check failed; inspect deployed revision and private manifest",
    )
    process.exitCode = 1
  }
}
