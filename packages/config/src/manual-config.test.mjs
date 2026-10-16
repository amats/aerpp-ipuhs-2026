import assert from "node:assert/strict"
import { test } from "node:test"
import { decodeManualConfig, encodeManualConfig } from "./manual-config.mjs"
import { ENVIRONMENT_SECTION_KEYS } from "./profiles.mjs"

test("manual keys round trip all runtime settings without changing values or references", () => {
  const config = { version: 1, infrastructure: { maxInstances: 2 } }
  for (const [section, keys] of Object.entries(ENVIRONMENT_SECTION_KEYS))
    config[section] = Object.fromEntries(
      keys
        .filter((key) => key !== "NEXTAUTH_URL")
        .map((key) => [key, { secret: key }]),
    )
  const before = structuredClone(config)
  const manual = encodeManualConfig(config)
  for (const section of Object.keys(ENVIRONMENT_SECTION_KEYS))
    for (const key of Object.keys(manual[section]))
      assert.match(key, /^[a-z][a-zA-Z0-9]*$/)
  assert.deepEqual(manual.logging.loggingServiceAccountJson, {
    secret: "LOGGING_SERVICE_ACCOUNT_JSON",
  })
  assert.equal(manual.admin.googleApplicationCredentials, undefined)
  assert.deepEqual(manual.admin.nextAuthSecret, { secret: "NEXTAUTH_SECRET" })
  assert.deepEqual(decodeManualConfig(manual), before)
  assert.deepEqual(config, before)
})

test("legacy keys require explicit migration and collisions are rejected", () => {
  const legacy = { admin: { ADMIN_ALLOWED_EMAILS: "synthetic@example.com" } }
  assert.throws(() => decodeManualConfig(legacy), /admin.adminAllowedEmails/)
  const duplicate = {
    admin: { ADMIN_ALLOWED_EMAILS: "a", adminAllowedEmails: "b" },
  }
  assert.throws(() => encodeManualConfig(duplicate), /duplicate/)
  assert.throws(
    () => decodeManualConfig(duplicate),
    /use admin.adminAllowedEmails/,
  )
})

test("shared access stays under Support and obsolete access aliases require migration", () => {
  const config = {
    support: {
      access: {
        revoked: false,
        notBefore: "1970-01-01T00:00:00Z",
        expiresAt: "2026-10-31T23:59:59+09:00",
        backendStopsAt: "2026-11-30T23:59:59+09:00",
      },
    },
  }
  assert.deepEqual(decodeManualConfig(encodeManualConfig(config)), config)
  for (const patch of [
    { webAccess: config.support.access },
    { backendStopsAt: config.support.access.backendStopsAt },
  ])
    assert.throws(
      () => decodeManualConfig({ support: { ...config.support, ...patch } }),
      /move support.webAccess and support.backendStopsAt to support.access/,
    )
})

for (const config of [
  { web: { supportContactEmail: "support@example.invalid" } },
  { shared: { participantApiEndpointsFile: "endpoints.json" } },
  { admin: { nextAuthUrl: "https://admin.example.invalid" } },
  { admin: { supportReceptionExpiresAt: "2099-01-01T00:00:00Z" } },
  { support: { credentials: [] } },
  { support: { tokenKeyId: "obsolete" } },
  { secretProvider: { type: "file", path: "secret.json" } },
])
  test(
    "manual profiles reject generated or fixed inputs: " +
      Object.keys(config)[0],
    () => {
      assert.throws(
        () => decodeManualConfig(config),
        /remove generated settings/,
      )
    },
  )

test("project selection belongs at the profile top level", () => {
  assert.deepEqual(decodeManualConfig({ projectId: "synthetic-test" }), {
    projectId: "synthetic-test",
  })
  assert.throws(
    () =>
      decodeManualConfig({ infrastructure: { projectId: "synthetic-test" } }),
    /top-level projectId/,
  )
})

test("test participant emails are normalized, deduplicated and validated without leaking values", () => {
  const config = {
    participants: {
      testEmailAddresses: [
        " Researcher@Example.invalid ",
        "researcher@example.invalid",
      ],
    },
  }
  assert.deepEqual(decodeManualConfig(config).participants.testEmailAddresses, [
    "researcher@example.invalid",
  ])
  for (const testEmailAddresses of [
    "private-value",
    ["private-value"],
    [null],
  ]) {
    assert.throws(
      () => decodeManualConfig({ participants: { testEmailAddresses } }),
      (error) =>
        error.message ===
        "Invalid participants.testEmailAddresses in config.json",
    )
  }
  assert.throws(() =>
    decodeManualConfig({
      participants: { testEmailAddresses: [], unknown: true },
    }),
  )
})
