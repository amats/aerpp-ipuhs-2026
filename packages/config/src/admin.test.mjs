import assert from "node:assert/strict"
import { test } from "node:test"
import { readAdminEnvironment } from "./admin.mjs"

const AUTH = Object.freeze({
  NODE_ENV: "production",
  GCP_PROJECT_ID: "synthetic-admin-project",
  PARTICIPANT_API_SERVER_ID: "synthetic-server",
  SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
  SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
  NEXTAUTH_SECRET: "  literal-$session  ",
  SESSION_SEAL_PASSWORD: "  literal-$email-seal-password-for-tests  ",
  IDENTIFIER_HASH_SECRET: "  literal-$identifier-secret  ",
  ADMIN_GOOGLE_OAUTH_CLIENT_ID: "synthetic-client",
  ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "  literal-$oauth  ",
})

test("Admin requires the existing Web email seal password without disclosing invalid values", () => {
  for (const value of [undefined, "", "private-short-value"]) {
    assert.throws(
      () => readAdminEnvironment({ ...AUTH, SESSION_SEAL_PASSWORD: value }),
      (error) => {
        assert.match(error.message, /SESSION_SEAL_PASSWORD/)
        assert.doesNotMatch(error.message, /private-short-value/)
        return true
      },
    )
  }
})

test("Admin parses only injected settings without requiring unrelated Web inputs", () => {
  const source = Object.freeze({
    ...AUTH,
    GCP_PROJECT_ID: "synthetic-project",
    ADMIN_ALLOWED_EMAILS: " First@example.com, SECOND@example.com, ",
  })
  const env = readAdminEnvironment(source)
  assert.equal(env.gcpProjectId, "synthetic-project")
  assert.equal(env.nextAuthSessionSecret, AUTH.NEXTAUTH_SECRET)
  assert.equal(env.sessionSealPassword, AUTH.SESSION_SEAL_PASSWORD)
  assert.equal(env.identifierHashSecret, AUTH.IDENTIFIER_HASH_SECRET)
  assert.equal(
    env.adminGoogleOAuthClientSecret,
    AUTH.ADMIN_GOOGLE_OAUTH_CLIENT_SECRET,
  )
  assert.deepEqual(env.adminAllowedEmails, [
    "first@example.com",
    "second@example.com",
  ])
  assert.equal(env.participantApiServerId, "synthetic-server")
})

test("development bypass preserves optional secrets and never enables hosted or production bypass", () => {
  const source = {
    IDENTIFIER_HASH_SECRET: AUTH.IDENTIFIER_HASH_SECRET,
    SESSION_SEAL_PASSWORD: AUTH.SESSION_SEAL_PASSWORD,
    SUPPORT_RECEPTION_EXPIRES_AT: AUTH.SUPPORT_RECEPTION_EXPIRES_AT,
    NODE_ENV: "development",
    AERPP_ENVIRONMENT: "example",
    GCP_PROJECT_ID: "demo-admin",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
    SUPPORT_BACKEND_STOPS_AT: AUTH.SUPPORT_BACKEND_STOPS_AT,
    ADMIN_AUTH_BYPASS_ENABLED: "true",
    PARTICIPANT_API_SERVER_ID: "synthetic-server",
  }
  assert.equal(readAdminEnvironment(source).adminAuthBypassEnabled, true)
  assert.equal(
    readAdminEnvironment({ ...AUTH, ...source }).nextAuthSessionSecret,
    AUTH.NEXTAUTH_SECRET,
  )
  assert.equal(
    readAdminEnvironment({ ...AUTH, ...source }).adminGoogleOAuthClientSecret,
    AUTH.ADMIN_GOOGLE_OAUTH_CLIENT_SECRET,
  )
  for (const nodeEnv of ["production", "test"]) {
    assert.equal(
      readAdminEnvironment({ ...AUTH, ...source, NODE_ENV: nodeEnv })
        .adminAuthBypassEnabled,
      false,
    )
    assert.throws(
      () => readAdminEnvironment({ ...source, NODE_ENV: nodeEnv }),
      /NEXTAUTH_SECRET/,
    )
  }
  assert.throws(
    () => readAdminEnvironment({ ...source, AERPP_ENVIRONMENT: "test" }),
    /must not skip authentication|Cloud configuration cannot contain emulator settings/,
  )
})

test("Admin rejects invalid target settings without disclosing supplied credentials", () => {
  for (const extra of [
    { GOOGLE_APPLICATION_CREDENTIALS: "private-obsolete-value" },
    { ADMIN_GCLOUD_ACCOUNT: "operator@example.invalid" },
    {
      GCP_PROJECT_ID: "synthetic-one",
      ADMIN_GCLOUD_ACCOUNT: "operator@example.invalid",
      ADMIN_LOCAL_SERVICE_ACCOUNT:
        "aerpp-admin-local@synthetic-two.iam.gserviceaccount.com",
    },
    { GCP_PROJECT_ID: "synthetic-one", GCLOUD_PROJECT: "synthetic-two" },
    { AERPP_ENVIRONMENT: "test", FIRESTORE_EMULATOR_HOST: "localhost:8080" },
  ]) {
    assert.throws(
      () => readAdminEnvironment({ ...AUTH, ...extra }),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /private-obsolete-value|literal-\$|synthetic-one|synthetic-two/,
        )
        return true
      },
    )
  }
})

test("Admin requires a fixed server scope instead of falling back to all servers", () => {
  for (const value of [undefined, "", "  ", "all"]) {
    assert.throws(
      () => readAdminEnvironment({ ...AUTH, PARTICIPANT_API_SERVER_ID: value }),
      /PARTICIPANT_API_SERVER_ID/,
    )
  }
  assert.equal(
    readAdminEnvironment({
      ...AUTH,
      PARTICIPANT_API_SERVER_ID: "  server-one  ",
    }).participantApiServerId,
    "server-one",
  )
})

test("Admin accepts a past reception cutoff for post-reception exports and rejects missing or invalid dates", () => {
  const env = readAdminEnvironment({
    ...AUTH,
    SUPPORT_RECEPTION_EXPIRES_AT: "2000-01-02T00:00:00+09:00",
    SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
  })
  assert.equal(
    env.supportReceptionExpiresAt.toISOString(),
    "2000-01-01T15:00:00.000Z",
  )
  for (const value of [
    undefined,
    "",
    "2030-02-30T00:00:00Z",
    "2030-01-01T00:00:00",
    "private-invalid-value",
  ])
    assert.throws(
      () =>
        readAdminEnvironment({ ...AUTH, SUPPORT_RECEPTION_EXPIRES_AT: value }),
      (error) => {
        assert.match(error.message, /SUPPORT_RECEPTION_EXPIRES_AT/)
        assert.doesNotMatch(error.message, /private-invalid-value/)
        return true
      },
    )
})

test("Admin requires the shared identifier secret even with development bypass", () => {
  for (const value of [undefined, "", "  "]) {
    for (const extra of [
      {},
      {
        NODE_ENV: "development",
        AERPP_ENVIRONMENT: "example",
        GCP_PROJECT_ID: "demo-admin",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
        ADMIN_AUTH_BYPASS_ENABLED: "true",
      },
    ])
      assert.throws(
        () =>
          readAdminEnvironment({
            ...AUTH,
            ...extra,
            IDENTIFIER_HASH_SECRET: value,
          }),
        /IDENTIFIER_HASH_SECRET/,
      )
  }
})

test("direct runtime startup cannot bypass authentication without all local isolation conditions", () => {
  const local = {
    ...AUTH,
    NODE_ENV: "development",
    AERPP_ENVIRONMENT: "example",
    GCP_PROJECT_ID: "demo-admin",
    FIRESTORE_EMULATOR_HOST: "localhost:8088",
    ADMIN_AUTH_BYPASS_ENABLED: "true",
  }
  assert.equal(readAdminEnvironment(local).adminAuthBypassEnabled, true)
  for (const patch of [
    { AERPP_ENVIRONMENT: undefined },
    { AERPP_ENVIRONMENT: "test" },
    { AERPP_ENVIRONMENT: "production" },
    { GCP_PROJECT_ID: undefined },
    { GCP_PROJECT_ID: "synthetic-cloud" },
    { FIRESTORE_EMULATOR_HOST: undefined },
    { FIRESTORE_EMULATOR_HOST: "remote.invalid:8088" },
    {
      ADMIN_GCLOUD_ACCOUNT: "operator@example.invalid",
      ADMIN_LOCAL_SERVICE_ACCOUNT:
        "aerpp-admin-local@demo-admin.iam.gserviceaccount.com",
    },
  ])
    assert.throws(() => readAdminEnvironment({ ...local, ...patch }))
  assert.throws(
    () => readAdminEnvironment({ ...AUTH, GCP_PROJECT_ID: undefined }),
    /explicit GCP project/,
  )
  for (const value of [undefined, "", "false"])
    assert.equal(
      readAdminEnvironment({
        ...AUTH,
        NODE_ENV: "development",
        ADMIN_AUTH_BYPASS_ENABLED: value,
      }).adminAuthBypassEnabled,
      false,
    )
  for (const value of [
    false,
    null,
    true,
    0,
    1,
    {},
    [],
    "0",
    "1",
    "yes",
    "ON",
    "invalid",
  ])
    assert.throws(
      () =>
        readAdminEnvironment({ ...local, ADMIN_AUTH_BYPASS_ENABLED: value }),
      /ADMIN_AUTH_BYPASS_ENABLED must be true or false/,
    )
})

test("Admin requires a backend stop at or after Web reception and accepts past dates for exports", () => {
  for (const value of [
    undefined,
    "",
    "invalid",
    "2099-01-01T00:00:00",
    "2098-12-31T23:59:59Z",
  ])
    assert.throws(
      () => readAdminEnvironment({ ...AUTH, SUPPORT_BACKEND_STOPS_AT: value }),
      /SUPPORT_BACKEND_STOPS_AT/,
    )
  assert.equal(
    readAdminEnvironment({
      ...AUTH,
      SUPPORT_RECEPTION_EXPIRES_AT: "2000-01-01T00:00:00Z",
      SUPPORT_BACKEND_STOPS_AT: "2000-02-01T00:00:00Z",
    }).supportBackendStopsAt.toISOString(),
    "2000-02-01T00:00:00.000Z",
  )
})
