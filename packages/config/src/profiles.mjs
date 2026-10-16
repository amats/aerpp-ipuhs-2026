export const ENVIRONMENT_SECTION_KEYS = Object.freeze({
  shared: ["PARTICIPANT_API_SERVER_ID"],
  web: [
    "SUPPORT_API_CREDENTIAL",
    "IDENTIFIER_HASH_SECRET",
    "SESSION_SEAL_PASSWORD",
    "LLM_PRESET_FILE",
    "SESSION_COOKIE_SECURE",
    "DEBUG_PAGES_ENABLED",
    "LOG_LEVEL",
    "NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN",
  ],
  admin: [
    "IDENTIFIER_HASH_SECRET",
    "SESSION_SEAL_PASSWORD",
    "NEXTAUTH_URL",
    "ADMIN_GOOGLE_OAUTH_CLIENT_ID",
    "NEXTAUTH_SECRET",
    "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
    "ADMIN_ALLOWED_EMAILS",
    "ADMIN_AUTH_BYPASS_ENABLED",
  ],
  logging: [
    "LOGGING_SERVICE_ACCOUNT_JSON",
    "GCP_LOGGING_LOCATION",
    "GCP_LOGGING_NAMESPACE",
  ],
})

export function deriveApplicationEnvironments(config, target, selectedApps) {
  const apps = selectedApps ?? ["web", "admin", "logging"]
  if (
    apps.some(
      (app) =>
        !Object.hasOwn(ENVIRONMENT_SECTION_KEYS, app) || app === "shared",
    )
  )
    throw new Error("Unknown application selection")
  if (
    config?.version !== 1 ||
    !config.secretProvider ||
    !["file", "environment"].includes(config.secretProvider.type)
  )
    throw new Error("Invalid environment config version or secret provider")
  if (
    config.secretProvider.type === "file" &&
    (typeof config.secretProvider.path !== "string" ||
      !config.secretProvider.path.trim())
  )
    throw new Error("File secret provider requires a private path")
  for (const key of Object.keys(config))
    if (
      ![
        "version",
        "projectId",
        "secretProvider",
        "infrastructure",
        "support",
        "participants",
        ...Object.keys(ENVIRONMENT_SECTION_KEYS),
      ].includes(key)
    )
      throw new Error("Unknown environment config section")
  for (const [section, keys] of Object.entries(ENVIRONMENT_SECTION_KEYS)) {
    if (
      section !== "shared" &&
      !apps.includes(section) &&
      config[section] === undefined
    )
      continue
    if (
      !config[section] ||
      typeof config[section] !== "object" ||
      Array.isArray(config[section])
    )
      throw new Error(`Missing configuration section: ${section}`)
    for (const key of Object.keys(config[section]))
      if (!keys.includes(key))
        throw new Error(`Unexpected or misplaced ${section} setting: ${key}`)
  }
  const shared = config.shared
  const project = { GCP_PROJECT_ID: target.project }
  const server = { PARTICIPANT_API_SERVER_ID: shared.PARTICIPANT_API_SERVER_ID }
  const adminSettings = config.admin ?? {}
  const projected = {
    web: { ...shared, ...config.web },
    admin: {
      ...project,
      ...server,
      ...adminSettings,
    },
    logging: {
      ...project,
      ...server,
      GCP_LOGGING_NAMESPACE: target.name,
      ...config.logging,
    },
  }
  return Object.fromEntries(
    apps.map((app) => [
      app,
      { AERPP_ENVIRONMENT: target.name, ...projected[app] },
    ]),
  )
}

export const APPLICATION_ENVIRONMENT_KEYS = [
  ...new Set([
    ...Object.values(ENVIRONMENT_SECTION_KEYS).flat(),
    "ADMIN_GCLOUD_ACCOUNT",
    "ADMIN_LOCAL_SERVICE_ACCOUNT",
    "ADMIN_GCLOUD_CONFIG",
    "GCP_PROJECT_ID",
    "AERPP_ENVIRONMENT",
    "SUPPORT_RUNTIME_JSON",
    "SUPPORT_API_BASE_URL",
    "AUTHENTICATION_EMAIL_SENDER",
    "SUPPORT_RECEPTION_EXPIRES_AT",
    "SUPPORT_BACKEND_STOPS_AT",
    "SUPPORT_CONTACT_EMAIL",
    "GCP_SERVICE_ACCOUNT_EMAIL",
    "GCP_SERVICE_ACCOUNT_PRIVATE_KEY",
  ]),
]
