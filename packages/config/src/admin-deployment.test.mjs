import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { adminServiceUrl, hostedAdminEnvironment } from "./admin-deployment.mjs"
import { parseAdminDeployment } from "./infrastructure.mjs"

const deployment = {
  version: 1,
  region: "asia-northeast1",
  service: "aerpp-admin",
  repository: "aerpp-admin",
  serviceAccountId: "aerpp-admin-runtime",
  maxInstances: 2,
}
test("deployment settings reject unknown fields and unsafe resource names", () => {
  assert.deepEqual(parseAdminDeployment(deployment), deployment)
  for (const input of [
    { ...deployment, project: "other-project" },
    { ...deployment, service: "--flag" },
    { ...deployment, region: "a/b" },
    { ...deployment, maxInstances: 0 },
    { ...deployment, serviceAccountId: "../file" },
  ])
    assert.throws(() => parseAdminDeployment(input))
  assert.equal(
    adminServiceUrl(deployment, "123456789000"),
    "https://aerpp-admin-123456789000.asia-northeast1.run.app",
  )
  assert.throws(() => adminServiceUrl(deployment, "--project=other"))
})
test("hosted projection uses ADC and keeps secret bytes outside ordinary environment settings", () => {
  const settings = {
    AERPP_ENVIRONMENT: "test",
    GCP_PROJECT_ID: "synthetic-test",
    NEXTAUTH_URL: "http://localhost:3001",
    PARTICIPANT_API_SERVER_ID: "synthetic-server",
    SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
    SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
    NEXTAUTH_SECRET: " $literal\nsecret ",
    SESSION_SEAL_PASSWORD: " $literal\nemail-seal-password-for-tests ",
    IDENTIFIER_HASH_SECRET: "  literal-$identifier-secret  ",
    ADMIN_GOOGLE_OAUTH_CLIENT_ID: "synthetic.apps.googleusercontent.com",
    ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: " literal$secret ",
    ADMIN_ALLOWED_EMAILS: "admin@example.com",
    GOOGLE_APPLICATION_CREDENTIALS: "/private/key.json",
    GCP_SERVICE_ACCOUNT_PRIVATE_KEY: "private-key",
    GCP_SERVICE_ACCOUNT_EMAIL: "synthetic@example.com",
  }
  const original = structuredClone(settings)
  const { runtime, secrets } = hostedAdminEnvironment(
    settings,
    "https://admin.example.com",
    "test",
  )
  assert.deepEqual(settings, original)
  assert.equal(runtime.NEXTAUTH_URL, "https://admin.example.com")
  assert.equal(
    runtime.SUPPORT_RECEPTION_EXPIRES_AT,
    settings.SUPPORT_RECEPTION_EXPIRES_AT,
  )
  const terraform = readFileSync(
    new URL("../../../infra/terraform/admin.tf", import.meta.url),
    "utf8",
  )
  const runtimeKeys = terraform.match(
    /for key in (\[[^\]]+\])\s*:\s*\{\s*name = key,\s*value = var\.admin\.runtime\[key\]/,
  )?.[1]
  assert(runtimeKeys, "Terraform must declare the hosted runtime allowlist")
  assert.deepEqual(JSON.parse(runtimeKeys).sort(), Object.keys(runtime).sort())
  for (const key of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCP_SERVICE_ACCOUNT_PRIVATE_KEY",
    "GCP_SERVICE_ACCOUNT_EMAIL",
    "NEXTAUTH_SECRET",
    "SESSION_SEAL_PASSWORD",
    "IDENTIFIER_HASH_SECRET",
    "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
  ])
    assert.equal(runtime[key], undefined)
  assert.equal(secrets.NEXTAUTH_SECRET, settings.NEXTAUTH_SECRET)
  assert.equal(secrets.SESSION_SEAL_PASSWORD, settings.SESSION_SEAL_PASSWORD)
  assert.equal(secrets.IDENTIFIER_HASH_SECRET, settings.IDENTIFIER_HASH_SECRET)
  assert.throws(() =>
    hostedAdminEnvironment(settings, "https://admin.example.com", "production"),
  )
  assert.throws(() =>
    hostedAdminEnvironment(settings, "http://localhost:3001", "test"),
  )
  assert.throws(() =>
    hostedAdminEnvironment(
      { ...settings, ADMIN_AUTH_BYPASS_ENABLED: "true" },
      "https://admin.example.com",
      "test",
    ),
  )
})
