import assert from "node:assert/strict"
import { test } from "node:test"
import { participantEmailRegexp } from "./support.mjs"
import { readWebEnvironment, validateWebRuntimeEnvironment } from "./web.mjs"
import { validateWebEnvironment } from "./web-validation.mjs"

const WEB = Object.freeze({
  PARTICIPANT_API_SERVER_ID: "synthetic-server",
  IDENTIFIER_HASH_SECRET: "  synthetic-$identifier  ",
  SESSION_SEAL_PASSWORD: "  synthetic-$session-password-0123456789  ",
  AERPP_ENVIRONMENT: "test",
  SUPPORT_API_BASE_URL: "https://support.example.invalid",
  SUPPORT_API_CREDENTIAL: `synthetic.${"a".repeat(43)}`,
  SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
  SUPPORT_CONTACT_EMAIL: "support@example.invalid",
})

test("Web and Support share recipient pattern syntax and ignore supplied flags", () => {
  for (const pattern of [
    "^[^@]+@example\\.invalid$",
    " /^[^@]+@example\\.invalid$/dgimsuvy ",
    "/^participant@(?:example\\.invalid|other\\.invalid)$/",
  ]) {
    assert.deepEqual(
      validateWebRuntimeEnvironment({
        ...WEB,
        NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: pattern,
      }),
      [],
    )
    const regexp = participantEmailRegexp(pattern)
    assert.equal(regexp.flags, "")
    assert.equal(regexp.test("participant@example.invalid"), true)
    assert.equal(regexp.test("participant@EXAMPLE.INVALID"), false)
    assert.equal(regexp.test("participant@unrelated.invalid"), false)
  }
  for (const pattern of ["[", "/valid/z"]) {
    assert.throws(() => participantEmailRegexp(pattern))
    assert.deepEqual(
      validateWebRuntimeEnvironment({
        ...WEB,
        NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: pattern,
      }),
      [
        "NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN (expected: valid regular expression)",
      ],
    )
  }
  for (const pattern of [undefined, "", " "]) {
    assert.throws(() => participantEmailRegexp(pattern))
    assert.deepEqual(
      validateWebRuntimeEnvironment({
        ...WEB,
        NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN: pattern,
      }),
      [],
    )
  }
})

test("Web requires only its own endpoints and preserves literal secret bytes", () => {
  const env = readWebEnvironment(WEB)
  assert.equal(env.supportApiCredential, WEB.SUPPORT_API_CREDENTIAL)
  assert.equal(env.identifierHashSecret, WEB.IDENTIFIER_HASH_SECRET)
  assert.equal(env.sessionSealPassword, WEB.SESSION_SEAL_PASSWORD)
  assert.equal(
    env.recordAnalysisAttemptUrl,
    "https://support.example.invalid/api/participant/analysis-attempt",
  )
  assert.deepEqual(validateWebRuntimeEnvironment(WEB), [])
})

test("runtime and CLI validation share errors without reading LLM files at runtime", () => {
  const source = { ...WEB, LLM_PRESET_FILE: "missing-preset.json" }
  assert.doesNotThrow(() => readWebEnvironment(source))
  assert.deepEqual(validateWebEnvironment(source, { checkLlm: false }), [])
  assert.deepEqual(
    validateWebEnvironment(source, { webDirectory: "/synthetic-missing-web" }),
    ["LLM_PRESET_FILE (file not found: missing-preset.json)"],
  )
  const invalid = {
    ...source,
    SESSION_COOKIE_SECURE: "invalid",
    SUPPORT_API_BASE_URL: undefined,
  }
  assert.deepEqual(
    validateWebEnvironment(invalid, { checkLlm: false }),
    validateWebRuntimeEnvironment(invalid),
  )
  assert.throws(() => readWebEnvironment(invalid), /SUPPORT_API_BASE_URL/)
})

test("support Web derives fixed routes and rejects mixed credentials or unsafe targets", () => {
  const source = {
    AERPP_ENVIRONMENT: "test",
    PARTICIPANT_API_SERVER_ID: WEB.PARTICIPANT_API_SERVER_ID,
    IDENTIFIER_HASH_SECRET: WEB.IDENTIFIER_HASH_SECRET,
    SESSION_SEAL_PASSWORD: WEB.SESSION_SEAL_PASSWORD,
    SUPPORT_API_BASE_URL: "https://support.example.invalid",
    SUPPORT_API_CREDENTIAL: `synthetic.${"a".repeat(43)}`,
    SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
    SUPPORT_CONTACT_EMAIL: "support@example.invalid",
  }
  const env = readWebEnvironment(source)
  assert.equal(env.supportApiCredential, source.SUPPORT_API_CREDENTIAL)
  assert.equal(
    env.sendMagicLinkUrl,
    "https://support.example.invalid/api/participant/send-magic-link",
  )
  assert.equal(
    env.recordAnalysisAttemptUrl,
    "https://support.example.invalid/api/participant/analysis-attempt",
  )
  for (const patch of [
    { AERPP_ENVIRONMENT: "example" },
    { SUPPORT_API_CREDENTIAL: "bad" },
    { SUPPORT_API_BASE_URL: "http://127.0.0.1:8090" },
    { SUPPORT_API_BASE_URL: "https://support.example.invalid/path" },
  ])
    assert.throws(() => readWebEnvironment({ ...source, ...patch }))
  assert.doesNotThrow(() =>
    readWebEnvironment({
      ...source,
      AERPP_ENVIRONMENT: "example",
      SUPPORT_API_BASE_URL: "http://127.0.0.1:8090",
    }),
  )
  assert.doesNotThrow(() =>
    readWebEnvironment({ ...WEB, AERPP_ENVIRONMENT: "production" }),
  )
})

test("reception cutoff is required, timezone-qualified and valid even after closure", () => {
  for (const value of [
    undefined,
    "",
    "not-a-date",
    "2026-09-22",
    "2026-09-22T09:00:00",
  ])
    assert.throws(
      () => readWebEnvironment({ ...WEB, SUPPORT_RECEPTION_EXPIRES_AT: value }),
      /SUPPORT_RECEPTION_EXPIRES_AT/,
    )
  const env = readWebEnvironment({
    ...WEB,
    SUPPORT_RECEPTION_EXPIRES_AT: "2000-01-01T09:00:00+09:00",
  })
  assert.equal(env.receptionExpiresAt.toISOString(), "2000-01-01T00:00:00.000Z")
})

test("Web requires a valid contact address without reporting its value", () => {
  assert.equal(
    readWebEnvironment(WEB).supportContactEmail,
    "support@example.invalid",
  )
  for (const value of [
    undefined,
    "",
    "invalid-contact",
    "support@example.invalid?subject=unexpected",
  ])
    assert.throws(
      () => readWebEnvironment({ ...WEB, SUPPORT_CONTACT_EMAIL: value }),
      (error) => {
        assert.match(error.message, /SUPPORT_CONTACT_EMAIL/)
        assert.doesNotMatch(error.message, /invalid-contact|unexpected/)
        return true
      },
    )
})
