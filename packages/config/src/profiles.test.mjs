import assert from "node:assert/strict"
import { test } from "node:test"
import { deriveApplicationEnvironments } from "./profiles.mjs"

test("projection distributes secrets only to their consumers and rejects app overrides of shared keys", () => {
  const config = {
    version: 1,
    participants: { testEmailAddresses: ["researcher@example.invalid"] },
    secretProvider: { type: "environment" },
    shared: {
      PARTICIPANT_API_SERVER_ID: "synthetic-server",
    },
    web: {
      IDENTIFIER_HASH_SECRET: { secret: "IDENTIFIER_SECRET" },
      SESSION_SEAL_PASSWORD: { secret: "WEB_SECRET" },
      SUPPORT_API_CREDENTIAL: { secret: "API_KEY" },
    },
    admin: {
      IDENTIFIER_HASH_SECRET: { secret: "IDENTIFIER_SECRET" },
      NEXTAUTH_SECRET: { secret: "ADMIN_SECRET" },
      SESSION_SEAL_PASSWORD: { secret: "WEB_SECRET" },
      ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: { secret: "OAUTH_SECRET" },
    },
    logging: {},
  }
  const target = {
    project: "synthetic-test",
    name: "test",
  }
  const env = deriveApplicationEnvironments(config, target)
  assert.equal(
    JSON.stringify(env).includes("researcher@example.invalid"),
    false,
  )
  assert.equal(JSON.stringify(env).includes("testEmailAddresses"), false)
  for (const app of ["admin", "logging"])
    assert.equal(env[app].SUPPORT_API_CREDENTIAL, undefined)
  assert.equal(env.logging.IDENTIFIER_HASH_SECRET, undefined)
  assert.deepEqual(
    env.admin.IDENTIFIER_HASH_SECRET,
    env.web.IDENTIFIER_HASH_SECRET,
  )
  assert.equal(env.logging.SESSION_SEAL_PASSWORD, undefined)
  assert.deepEqual(
    env.admin.SESSION_SEAL_PASSWORD,
    env.web.SESSION_SEAL_PASSWORD,
  )
  assert.equal(env.web.NEXTAUTH_SECRET, undefined)
  for (const app of ["web", "logging"]) {
    assert.equal(env[app].ADMIN_GOOGLE_OAUTH_CLIENT_SECRET, undefined)
    assert.equal(env[app].ADMIN_SERVICE_ACCOUNT_JSON, undefined)
  }
  assert.throws(
    () =>
      deriveApplicationEnvironments(
        { ...config, web: { PARTICIPANT_API_SERVER_ID: "conflict" } },
        target,
      ),
    /misplaced/,
  )
})
