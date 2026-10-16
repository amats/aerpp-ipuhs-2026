import assert from "node:assert/strict"
import { test } from "node:test"
import { assertEnvironmentSafety, requireConfigured } from "./safety.mjs"
import {
  checkApplication,
  checkEnvironment,
  environmentDirectory,
  prepareApplicationRuntime,
} from "./workspace.mjs"

test("public example loads and validates without cloud aliases or credentials", () => {
  const directory = environmentDirectory("example")
  const { target, values } = prepareApplicationRuntime("example", directory, {
    projects: {},
  })
  assert.equal(target.project, "demo-aerpp")
  assert.deepEqual(Object.keys(values), ["web", "support"])
  assert.match(values.web.SUPPORT_API_CREDENTIAL, /^local-example-reader\./)
  assert.equal(values.web.SESSION_COOKIE_SECURE, "false")
  assert.equal(values.web.SUPPORT_API_BASE_URL, "http://127.0.0.1:8090")
  assert.doesNotThrow(() => checkEnvironment("example", directory, {}))
  for (const app of ["admin", "cloud", "logging"])
    assert.throws(
      () =>
        prepareApplicationRuntime("example", directory, {
          projects: {},
          apps: app,
        }),
      /unavailable/,
    )
})

test("runtime safety rejects mixed targets and public cloud secrets without exposing values", () => {
  const secret = "local-example-private-value-for-test"
  for (const overrides of [
    { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    { FUNCTIONS_EMULATOR: "true" },
    { GCP_PROJECT_ID: "demo-aerpp" },
    { ADMIN_AUTH_BYPASS_ENABLED: "true" },
    { SUPPORT_API_CREDENTIAL: secret },
    { GOOGLE_CLOUD_PROJECT: "different-project" },
    { SUPPORT_API_BASE_URL: "http://localhost:5001/send" },
  ]) {
    assert.throws(
      () =>
        assertEnvironmentSafety({
          AERPP_ENVIRONMENT: "test",
          GCP_PROJECT_ID: "synthetic-cloud",
          ...overrides,
        }),
      (error) => !error.message.includes(secret),
    )
  }
  assert.throws(
    () =>
      assertEnvironmentSafety({
        AERPP_ENVIRONMENT: "example",
        SUPPORT_API_BASE_URL: "https://remote.invalid/",
      }),
    /loopback/,
  )
  assert.throws(
    () =>
      assertEnvironmentSafety({
        FUNCTIONS_EMULATOR: "true",
        GCP_PROJECT_ID: "synthetic-cloud",
      }),
    /demo project/,
  )
})

test("readiness recognizes explicit placeholders without rejecting legitimate substrings", () => {
  assert.doesNotThrow(() =>
    requireConfigured(
      { KEY: "contains-example-within-a-value" },
      ["KEY"],
      "synthetic",
    ),
  )
  for (const value of ["", "  ", "YOUR_KEY", "replace-with-key"])
    assert.throws(
      () => requireConfigured({ KEY: value }, ["KEY"], "synthetic"),
      /placeholder/,
    )
  assert.doesNotThrow(() =>
    checkApplication(
      "admin",
      {
        NEXTAUTH_URL: "http://localhost:3001",
        GCP_PROJECT_ID: "synthetic-admin-project",
        PARTICIPANT_API_SERVER_ID: "synthetic-server",
        SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
        SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
        NEXTAUTH_SECRET: "synthetic-session",
        SESSION_SEAL_PASSWORD: "synthetic-email-seal-password-for-tests",
        IDENTIFIER_HASH_SECRET: "synthetic-identifier-secret",
        ADMIN_GOOGLE_OAUTH_CLIENT_ID: "synthetic.apps.googleusercontent.com",
        ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-secret",
        ADMIN_ALLOWED_EMAILS: "operator@example.org",
      },
      "test",
    ),
  )
})
