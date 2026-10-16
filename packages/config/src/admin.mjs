import { z } from "zod"
import {
  readOptionalEnvironment,
  readRequiredEnvironment,
  resolveGcpProjectId,
} from "./index.mjs"
import { assertEnvironmentSafety } from "./safety.mjs"

export function readAdminEnvironment(source) {
  assertEnvironmentSafety(source)
  const readOptionalEnv = (key) => readOptionalEnvironment(source, key)?.trim()
  const readRequiredEnv = (key) => readRequiredEnvironment(source, key)

  function readCsvEnv(key) {
    const value = readOptionalEnv(key)
    if (!value) {
      return []
    }

    return value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== "")
  }

  for (const key of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCP_SERVICE_ACCOUNT_EMAIL",
    "GCP_SERVICE_ACCOUNT_PRIVATE_KEY",
    "ADMIN_SERVICE_ACCOUNT_JSON",
  ]) {
    if (readOptionalEnv(key))
      throw new Error(
        "Admin uses keyless Google authentication; remove credential-file and private-key settings",
      )
  }
  const localGoogleAccount = readOptionalEnv("ADMIN_GCLOUD_ACCOUNT")
  const localServiceAccount = readOptionalEnv("ADMIN_LOCAL_SERVICE_ACCOUNT")
  const gcpProjectId = resolveGcpProjectId(source)
  if (!gcpProjectId || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(gcpProjectId))
    throw new Error("Admin requires an explicit GCP project")
  if (
    localGoogleAccount ||
    localServiceAccount ||
    readOptionalEnv("ADMIN_GCLOUD_CONFIG")
  ) {
    if (
      !localGoogleAccount ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(localGoogleAccount) ||
      !gcpProjectId ||
      localServiceAccount !==
        `aerpp-admin-local@${gcpProjectId}.iam.gserviceaccount.com`
    ) {
      throw new Error(
        "Local Admin requires a complete, project-bound gcloud identity",
      )
    }
  }

  const nodeEnv = source.NODE_ENV ?? "development"
  const bypass = source.ADMIN_AUTH_BYPASS_ENABLED
  if (![undefined, "", "true", "false"].includes(bypass))
    throw new Error("ADMIN_AUTH_BYPASS_ENABLED must be true or false")
  const adminAuthBypassEnabled = nodeEnv === "development" && bypass === "true"
  if (
    adminAuthBypassEnabled === true &&
    (readOptionalEnv("AERPP_ENVIRONMENT") !== "example" ||
      !gcpProjectId.startsWith("demo-") ||
      !/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/.test(
        readOptionalEnv("FIRESTORE_EMULATOR_HOST") ?? "",
      ) ||
      localGoogleAccount !== undefined ||
      localServiceAccount !== undefined)
  )
    throw new Error(
      "Admin authentication bypass requires the explicit example environment, a demo project and a loopback Firestore emulator",
    )

  const participantApiServerId = readRequiredEnv(
    "PARTICIPANT_API_SERVER_ID",
  ).trim()
  if (participantApiServerId === "all")
    throw new Error("Admin requires a specific PARTICIPANT_API_SERVER_ID")
  const receptionExpiry = z.iso
    .datetime({ offset: true })
    .safeParse(readRequiredEnv("SUPPORT_RECEPTION_EXPIRES_AT"))
  if (receptionExpiry.success !== true)
    throw new Error(
      "Invalid SUPPORT_RECEPTION_EXPIRES_AT; expected ISO timestamp with timezone",
    )
  const backendStop = z.iso
    .datetime({ offset: true })
    .safeParse(readRequiredEnv("SUPPORT_BACKEND_STOPS_AT"))
  if (
    backendStop.success !== true ||
    Date.parse(backendStop.data) < Date.parse(receptionExpiry.data)
  )
    throw new Error(
      "Invalid SUPPORT_BACKEND_STOPS_AT; expected an ISO timestamp at or after Web reception expiry",
    )
  const sessionSealPassword = readRequiredEnv("SESSION_SEAL_PASSWORD")
  if (sessionSealPassword.length < 32)
    throw new Error("SESSION_SEAL_PASSWORD must contain at least 32 characters")

  return {
    nodeEnv,
    environment: readOptionalEnv("AERPP_ENVIRONMENT") ?? "local",
    adminAuthBypassEnabled,
    localGoogleAccount,
    localServiceAccount,
    gcloudConfigDirectory: readOptionalEnv("ADMIN_GCLOUD_CONFIG"),
    nextAuthSessionSecret:
      adminAuthBypassEnabled === true
        ? readOptionalEnvironment(source, "NEXTAUTH_SECRET")
        : readRequiredEnv("NEXTAUTH_SECRET"),
    adminGoogleOAuthClientId:
      adminAuthBypassEnabled === true
        ? readOptionalEnv("ADMIN_GOOGLE_OAUTH_CLIENT_ID")
        : readRequiredEnv("ADMIN_GOOGLE_OAUTH_CLIENT_ID"),
    adminGoogleOAuthClientSecret:
      adminAuthBypassEnabled === true
        ? readOptionalEnvironment(source, "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET")
        : readRequiredEnv("ADMIN_GOOGLE_OAUTH_CLIENT_SECRET"),
    adminAllowedEmails: readCsvEnv("ADMIN_ALLOWED_EMAILS"),
    gcpProjectId,
    participantApiServerId,
    supportReceptionExpiresAt: new Date(receptionExpiry.data),
    supportBackendStopsAt: new Date(backendStop.data),
    sessionSealPassword,
    identifierHashSecret: readRequiredEnv("IDENTIFIER_HASH_SECRET"),
  }
}
