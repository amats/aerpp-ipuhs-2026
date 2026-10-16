import { readdirSync } from "node:fs"
import { APPLICATION_ENVIRONMENT_KEYS } from "./profiles.mjs"
import { assertEnvironmentSafety } from "./safety.mjs"

export function applicationEnvironment(settings, inherited = process.env) {
  const result = {}
  for (const key of [
    "PATH",
    "JAVA_HOME",
    "FIREBASE_EMULATORS_PATH",
    "CI",
    "HOME",
    "USER",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SYSTEMROOT",
    "PLAYWRIGHT_BROWSERS_PATH",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ])
    if (inherited[key] !== undefined) result[key] = inherited[key]
  // Do not inherit unrelated application settings or implicit SDK targets.
  for (const key of [
    ...APPLICATION_ENVIRONMENT_KEYS,
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCP_SERVICE_ACCOUNT_EMAIL",
    "GCP_SERVICE_ACCOUNT_PRIVATE_KEY",
    "GOOGLE_CLOUD_PROJECT",
    "GCLOUD_PROJECT",
    "NODE_OPTIONS",
    "FUNCTIONS_EMULATOR",
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
  ])
    result[key] = ""
  const env = { ...result, ...settings }
  assertEnvironmentSafety(env)
  return env
}

export function assertNoAppEnvFiles(directory) {
  if (readdirSync(directory).some((file) => file.startsWith(".env")))
    throw new Error(
      "Shared configuration cannot be combined with app-local .env files; move required settings to the shared profile and remove them before using env:run",
    )
}
