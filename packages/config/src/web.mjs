import { z } from "zod"
import { readOptionalEnvironment } from "./index.mjs"
import { participantEmailRegexp } from "./participant-email-regexp.mjs"
import { assertEnvironmentSafety } from "./safety.mjs"
import { buildSupportUrls } from "./support-routes.mjs"

const REQUIRED_ENV = [
  "PARTICIPANT_API_SERVER_ID",
  "IDENTIFIER_HASH_SECRET",
  "SESSION_SEAL_PASSWORD",
  "SUPPORT_RECEPTION_EXPIRES_AT",
  "SUPPORT_CONTACT_EMAIL",
]

const LOG_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
])

export function validateWebRuntimeEnvironment(source) {
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([, value]) => typeof value === "string" && value.trim(),
    ),
  )
  const validationErrors = REQUIRED_ENV.filter((key) => !env[key])
  if (
    env.AUTHENTICATION_EMAIL_SENDER &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.AUTHENTICATION_EMAIL_SENDER)
  )
    validationErrors.push("AUTHENTICATION_EMAIL_SENDER")
  if (
    env.SUPPORT_CONTACT_EMAIL &&
    !z.string().email().safeParse(env.SUPPORT_CONTACT_EMAIL).success
  )
    validationErrors.push("SUPPORT_CONTACT_EMAIL")
  if (
    !/^[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{43,128}$/.test(
      env.SUPPORT_API_CREDENTIAL ?? "",
    )
  )
    validationErrors.push("SUPPORT_API_CREDENTIAL")
  try {
    buildSupportUrls(env.SUPPORT_API_BASE_URL)
    const url = new URL(env.SUPPORT_API_BASE_URL)
    if (
      !["example", "test", "production"].includes(env.AERPP_ENVIRONMENT) ||
      (env.AERPP_ENVIRONMENT === "example" &&
        (url.protocol !== "http:" ||
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
      (env.AERPP_ENVIRONMENT !== "example" && url.protocol !== "https:")
    )
      throw new Error()
  } catch {
    validationErrors.push(
      "SUPPORT_API_BASE_URL (expected: selected local/cloud origin)",
    )
  }
  try {
    assertEnvironmentSafety(env)
  } catch (error) {
    validationErrors.push(error.message)
  }
  if (env.SESSION_SEAL_PASSWORD && env.SESSION_SEAL_PASSWORD.length < 32) {
    validationErrors.push(
      "SESSION_SEAL_PASSWORD (expected: at least 32 characters)",
    )
  }

  const receptionExpiry = env.SUPPORT_RECEPTION_EXPIRES_AT
  if (
    receptionExpiry &&
    (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(receptionExpiry) ||
      !Number.isFinite(Date.parse(receptionExpiry)))
  )
    validationErrors.push(
      "SUPPORT_RECEPTION_EXPIRES_AT (expected: ISO 8601 timestamp with timezone)",
    )

  function validateBooleanEnv(key) {
    const value = env[key]
    if (
      value &&
      value.toLowerCase() !== "true" &&
      value.toLowerCase() !== "false"
    ) {
      validationErrors.push(`${key} (expected: true or false)`)
    }
  }

  validateBooleanEnv("DEBUG_PAGES_ENABLED")
  validateBooleanEnv("SESSION_COOKIE_SECURE")

  const logLevel = env.LOG_LEVEL
  if (logLevel && !LOG_LEVELS.has(logLevel)) {
    validationErrors.push(`LOG_LEVEL (expected: ${[...LOG_LEVELS].join(", ")})`)
  }

  const emailPattern = env.NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN
  if (emailPattern) {
    try {
      participantEmailRegexp(emailPattern)
    } catch {
      validationErrors.push(
        "NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN (expected: valid regular expression)",
      )
    }
  }

  return [...new Set(validationErrors)]
}

export function readWebEnvironment(source) {
  const errors = validateWebRuntimeEnvironment(source)
  if (errors.length)
    throw new Error(`Invalid environment configuration: ${errors.join("; ")}`)
  const optional = (key) => readOptionalEnvironment(source, key)
  const urls = buildSupportUrls(source.SUPPORT_API_BASE_URL)
  const nodeEnv = optional("NODE_ENV")
  return {
    nodeEnv,
    debugPagesEnabled:
      nodeEnv !== "production" &&
      optional("DEBUG_PAGES_ENABLED")?.toLowerCase() !== "false",
    participantApiServerId: source.PARTICIPANT_API_SERVER_ID,
    identifierHashSecret: source.IDENTIFIER_HASH_SECRET,
    sessionSealPassword: source.SESSION_SEAL_PASSWORD,
    supportContactEmail: source.SUPPORT_CONTACT_EMAIL,
    authenticationEmailSender: optional("AUTHENTICATION_EMAIL_SENDER"),
    supportApiCredential: source.SUPPORT_API_CREDENTIAL,
    readDocumentOriginalUrl: urls.readDocumentOriginal,
    sendMagicLinkUrl: urls.sendMagicLink,
    verifyAuthenticationUrl: urls.verifyAuthentication,
    withdrawParticipationUrl: urls.withdrawParticipation,
    listParticipationEventsUrl: urls.listParticipationEvents,
    getParticipationStateUrl: urls.getParticipationState,
    recordAnalysisAttemptUrl: urls.recordAnalysisAttempt,
    recordAnalysisOutcomeUrl: urls.recordAnalysisOutcome,
    recordAnalysisCompletionUrl: urls.recordAnalysisCompletion,
    submitSurveyUrl: urls.submitSurvey,
    getInformationUrl: urls.getInformation,
    sessionCookieSecure:
      optional("SESSION_COOKIE_SECURE")?.toLowerCase() !== "false",
    receptionExpiresAt: new Date(source.SUPPORT_RECEPTION_EXPIRES_AT),
    logLevel:
      optional("LOG_LEVEL") ?? (nodeEnv === "production" ? "info" : "debug"),
  }
}
