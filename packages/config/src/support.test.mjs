import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { applicationEnvironment } from "./process.mjs"
import {
  readSupportEnvironment,
  supportMaintenanceWindowActive,
} from "./support.mjs"

function settings() {
  return {
    environment: "local",
    projectId: "demo-support",
    baseUrl: "http://127.0.0.1:8080",
    admissionOpen: false,
    maintenanceEnabled: false,
    credentials: [
      {
        id: "local",
        verifierHash: createHash("sha256").update("synthetic").digest("hex"),
        serverId: "server-1",
        environment: "local",
        operations: ["getInformation"],
        notBeforeMs: 0,
        expiresAtMs: 253402300799999,
        revoked: false,
      },
    ],
    tokenKey: "synthetic-local-token-secret-0000000000000000000000",
    schedulerIdentity: "scheduler@example.invalid",
    contactEmail: "contact@example.invalid",
    mailMode: "sink",
  }
}
const env = (runtime = settings(), extra = {}) => ({
  SUPPORT_RUNTIME_JSON: JSON.stringify(runtime),
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8888",
  ...extra,
})
test("maintenance starts twelve hours before access and ends at backend stop", () => {
  const runtime = settings()
  runtime.credentials[0].notBeforeMs = 100_000_000
  runtime.credentials[0].expiresAtMs = 200_000_000
  for (const [now, expected] of [
    [56_799_999, false],
    [56_800_000, true],
    [100_000_000, true],
    [199_999_999, true],
    [200_000_000, false],
    [243_199_999, false],
    [243_200_000, false],
  ])
    assert.equal(supportMaintenanceWindowActive(runtime, now), expected)
  runtime.credentials[0].revoked = true
  assert.equal(supportMaintenanceWindowActive(runtime, 150_000_000), false)
  runtime.credentials[0].revoked = false
  runtime.credentials[0].environment = "production"
  assert.equal(supportMaintenanceWindowActive(runtime, 150_000_000), false)
})
test("participant-history erasure is not a runtime operation", () => {
  const runtime = settings()
  runtime.credentials[0].operations.push("debugResetParticipation")
  assert.throws(
    () => readSupportEnvironment(env(runtime)),
    /Invalid support runtime/,
  )
})
test("support runtime requires explicit local isolation and never inherits its secrets into other apps", () => {
  assert.equal(readSupportEnvironment(env()).projectId, "demo-support")
  assert.equal(applicationEnvironment({}, env()).SUPPORT_RUNTIME_JSON, "")
  for (const extra of [
    { FIRESTORE_EMULATOR_HOST: "" },
    { GOOGLE_APPLICATION_CREDENTIALS: "/private/key" },
    { GCLOUD_PROJECT: "another-project" },
    { GCP_PROJECT_ID: "another-project" },
    { AERPP_ENVIRONMENT: "production" },
  ])
    assert.throws(
      () => readSupportEnvironment(env(settings(), extra)),
      /Invalid support runtime configuration/,
    )
})
test("support rejects unknown/missing settings, duplicate credentials, unrecognized operations and production", () => {
  for (const runtime of [
    { ...settings(), environment: "production" },
    { ...settings(), credentials: [] },
    {
      ...settings(),
      credentials: [settings().credentials[0], settings().credentials[0]],
    },
    { ...settings(), extra: "private-value" },
    { ...settings(), tokenKey: "" },
    { ...settings(), baseUrl: "https://support.example.invalid/path" },
    {
      ...settings(),
      credentials: [{ ...settings().credentials[0], operations: ["unknown"] }],
    },
  ]) {
    assert.throws(
      () => readSupportEnvironment(env(runtime)),
      (error) => !error.message.includes("private-value"),
    )
  }
})
test("test cloud requires Gmail and rejects all emulator and local credential injection", () => {
  const runtime = {
    ...settings(),
    environment: "test",
    projectId: "synthetic-test-project",
    baseUrl: "https://support.example.invalid",
    mailMode: "gmail",
    gmail: {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      sender: "sender@example.invalid",
      participantEmailPattern: "^recipient@example\\.invalid$",
    },
  }
  runtime.credentials[0].environment = "test"
  assert.equal(
    readSupportEnvironment(env(runtime, { FIRESTORE_EMULATOR_HOST: "" }))
      .environment,
    "test",
  )
  assert.throws(() => readSupportEnvironment(env(runtime)))
  assert.throws(() =>
    readSupportEnvironment(
      env({ ...runtime, mailMode: "sink" }, { FIRESTORE_EMULATOR_HOST: "" }),
    ),
  )
  assert.throws(() =>
    readSupportEnvironment(
      env({ ...runtime, gmail: undefined }, { FIRESTORE_EMULATOR_HOST: "" }),
    ),
  )
})
