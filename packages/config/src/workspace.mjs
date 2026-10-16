import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { basename, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { readAccessProfile } from "./access-profile.mjs"
import { readAdminEnvironment } from "./admin.mjs"
import { readAutoSettings } from "./auto-settings.mjs"
import {
  materializeServiceCredential,
  SERVICE_CREDENTIAL_KEYS,
} from "./credential-files.mjs"
import { decodeManualConfig, encodeManualConfig } from "./manual-config.mjs"
import {
  OAUTH_CREDENTIAL_KEYS,
  projectOAuthCredentials,
} from "./oauth-credentials.mjs"
import { deriveApplicationEnvironments } from "./profiles.mjs"
import {
  assertEnvironmentSafety,
  environmentDefinition,
  isPlaceholder,
  requireConfigured,
} from "./safety.mjs"
import {
  createFileSecretProvider,
  resolveSecretReferences,
} from "./secrets.mjs"
import { readSupportEnvironment } from "./support.mjs"
import { projectSupportEnvironment } from "./support-profile.mjs"
import { environmentTarget } from "./targets.mjs"
import { validateSupportFoundation } from "./terraform.mjs"
import { validateWebEnvironment } from "./web-validation.mjs"

export const ROOT = fileURLToPath(new URL("../../..", import.meta.url))
export function environmentDirectory(name, root = ROOT) {
  return resolve(root, "config", environmentDefinition(name).directory)
}
export function generatedEnvironmentDirectory(name, root = ROOT) {
  return resolve(root, "generated", basename(environmentDirectory(name, root)))
}
const SECRET_KEYS = [
  "SUPPORT_API_CREDENTIAL",
  "IDENTIFIER_HASH_SECRET",
  "SESSION_SEAL_PASSWORD",
  "NEXTAUTH_SECRET",
  "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
  "LOGGING_SERVICE_ACCOUNT_JSON",
]

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error(`Cannot read ${label}`)
  }
}
const FIXED_SECRET_REFERENCES = {
  web: {
    IDENTIFIER_HASH_SECRET: "IDENTIFIER_HASH_SECRET",
    SESSION_SEAL_PASSWORD: "SESSION_SEAL_PASSWORD",
    SUPPORT_API_CREDENTIAL: "SUPPORT_WEB_API_CREDENTIAL",
  },
  admin: {
    NEXTAUTH_SECRET: "NEXTAUTH_SECRET",
    SESSION_SEAL_PASSWORD: "SESSION_SEAL_PASSWORD",
    IDENTIFIER_HASH_SECRET: "IDENTIFIER_HASH_SECRET",
  },
  logging: { LOGGING_SERVICE_ACCOUNT_JSON: "LOGGING_SERVICE_ACCOUNT_JSON" },
}
function applySecretReferences(config) {
  for (const [app, refs] of Object.entries(FIXED_SECRET_REFERENCES)) {
    if (!config[app]) continue
    for (const [key, secret] of Object.entries(refs))
      config[app][key] ??= { secret }
  }
  if (config.support) {
    config.support.tokenKey ??= { secret: "SUPPORT_TOKEN_KEY" }
    if (config.support.gmail) {
      config.support.gmail.refreshToken ??= {
        secret: "SUPPORT_GMAIL_REFRESH_TOKEN",
      }
    }
  }
  return config
}
export function initializeEnvironment(name, directory, projects) {
  if (name === "example")
    throw new Error(
      "The public example is already maintained in config/example",
    )
  const target = environmentTarget(name, projects)
  if (existsSync(resolve(directory, "config.json"))) return
  if (
    existsSync(resolve(directory, "secret.json")) ||
    existsSync(resolve(directory, "secrets.json"))
  )
    throw new Error(
      "Secret store exists without config.json; restore configuration instead of overwriting secrets",
    )
  const config = decodeManualConfig(
    readJson(
      resolve(ROOT, "packages/config/templates/cloud-template.json"),
      "shared configuration template",
    ),
  )
  if (isPlaceholder(config.shared.PARTICIPANT_API_SERVER_ID))
    config.shared.PARTICIPANT_API_SERVER_ID = `aerpp-${name}-01`
  config.web.DEBUG_PAGES_ENABLED = String(name === "test")
  config.web.LOG_LEVEL = name === "test" ? "debug" : "info"
  config.projectId = target.project
  const secrets = {}
  function collect(value) {
    if (!value || typeof value !== "object") return
    if (typeof value.secret === "string") {
      secrets[value.secret] =
        `replace-with-${value.secret.toLowerCase().replaceAll("_", "-")}`
      return
    }
    for (const nested of Object.values(value)) collect(nested)
  }
  collect(applySecretReferences(structuredClone(config)))
  for (const [app, key] of Object.entries(OAUTH_CREDENTIAL_KEYS))
    if (config[app])
      secrets[key] = {
        web: {
          project_id: target.project,
          client_id: "YOUR_WEB_CLIENT_ID",
          client_secret: "YOUR_CLIENT_SECRET",
        },
      }
  deriveApplicationEnvironments(
    { ...config, secretProvider: { type: "file", path: "secret.json" } },
    target,
  )
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(
    resolve(directory, "secret.json"),
    `${JSON.stringify(secrets, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  )
  writeFileSync(
    resolve(directory, "config.json"),
    `${JSON.stringify(encodeManualConfig(config), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  )
}

function resolveApplicationSettings(
  name,
  directory,
  { projects, apps: selectedApp } = {},
) {
  const definition = environmentDefinition(name)
  const input = decodeManualConfig(
    readJson(resolve(directory, "config.json"), "config.json"),
  )
  // The public template illustrates a cloud sender, but local runs only use the mail sink.
  if (name === "example" && input.support?.gmail !== undefined) {
    const sender = z
      .object({ sender: z.email() })
      .strict()
      .safeParse(input.support.gmail)
    if (!sender.success)
      throw new Error(
        "Example support.gmail permits only an illustrative sender address",
      )
    delete input.support.gmail
  }
  const supportWeb = Boolean(input.web)
  const apps = selectedApp
    ? Array.isArray(selectedApp)
      ? selectedApp
      : [selectedApp]
    : definition.apps
  if (apps.some((app) => !definition.apps.includes(app)))
    throw new Error(
      `${name}: selected application is unavailable; Admin and cloud checks require a cloud profile`,
    )
  const target = environmentTarget(name, projects)
  const access = apps.some((app) => ["web", "admin", "support"].includes(app))
    ? readAccessProfile(input.support?.access)
    : undefined
  if (input.projectId !== undefined && input.projectId !== target.project)
    throw new Error("Selected profile project differs from the target")
  const automatic =
    definition.kind === "cloud" ? readAutoSettings(directory, target) : {}
  const config = applySecretReferences(structuredClone(input))
  config.secretProvider = { type: "file", path: "secret.json" }
  config.shared ??= {}
  if (automatic.deployment && !config.shared.PARTICIPANT_API_SERVER_ID)
    config.shared.PARTICIPANT_API_SERVER_ID = `aerpp-${name}-01`
  if (apps.includes("admin") && automatic.adminUrl) {
    config.admin ??= {}
    config.admin.NEXTAUTH_URL = automatic.adminUrl
  }
  if (apps.includes("logging") && automatic.deployment) {
    config.logging ??= {}
    config.logging.GCP_LOGGING_LOCATION ??= automatic.deployment.region
    config.logging.GCP_LOGGING_NAMESPACE ??= name
  }

  const provider = projectOAuthCredentials(
    config,
    target,
    createFileSecretProvider(resolve(directory, "secret.json")),
    apps,
  )
  const ordinaryApps = apps.filter((app) => app !== "support")
  const projected = deriveApplicationEnvironments(config, target, ordinaryApps)
  if (projected.admin) {
    projected.admin.SUPPORT_RECEPTION_EXPIRES_AT = access.expiresAt
    projected.admin.SUPPORT_BACKEND_STOPS_AT = access.backendStopsAt
  }
  if (supportWeb && projected.web) {
    projected.web.SUPPORT_RECEPTION_EXPIRES_AT = access.expiresAt
    projected.web.SUPPORT_CONTACT_EMAIL = input.support?.contactEmail
    const sender = input.support?.gmail?.sender
    if (sender !== undefined) {
      if (
        typeof sender !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)
      )
        throw new Error("Invalid support.gmail.sender")
      projected.web.AUTHENTICATION_EMAIL_SENDER = sender
    }
    if (name === "example")
      projected.web.SUPPORT_API_BASE_URL = input.support?.local?.baseUrl
    else {
      if (!input.infrastructure?.region)
        throw new Error(
          "Support Web requires the selected infrastructure region",
        )
      const foundation = validateSupportFoundation(
        automatic.terraform?.support,
        target,
        input.infrastructure.region,
      )
      if (
        automatic.projectNumber &&
        automatic.projectNumber !== foundation.serviceEndpoint?.projectNumber
      )
        throw new Error(
          "Support Web project number conflicts with discovered metadata",
        )
      projected.web.SUPPORT_API_BASE_URL = foundation.serviceEndpoint?.baseUrl
    }
    if (!projected.web.SUPPORT_API_BASE_URL)
      throw new Error("Support Web requires the selected support base origin")
  }
  for (const app of ordinaryApps.length ? ["shared", ...ordinaryApps] : [])
    for (const [key, value] of Object.entries(config[app] ?? {})) {
      if (
        SECRET_KEYS.includes(key) &&
        (!value ||
          typeof value !== "object" ||
          typeof value.secret !== "string")
      )
        throw new Error(
          `${key} must reference the authoritative secret.json file`,
        )
    }
  const values = Object.fromEntries(
    Object.entries(projected).map(([app, settings]) => {
      const key = SERVICE_CREDENTIAL_KEYS[app]
      const ordinarySettings = { ...settings }
      if (key) delete ordinarySettings[key]
      const resolved = resolveSecretReferences(ordinarySettings, provider)
      if (key && settings[key])
        resolved[key] = provider.getJsonSecret(settings[key].secret)
      return [app, resolved]
    }),
  )
  if (apps.includes("support"))
    values.support = projectSupportEnvironment(
      config.support,
      target,
      automatic,
      provider,
      input.infrastructure,
      config.shared?.PARTICIPANT_API_SERVER_ID,
      config.web?.NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN,
      config.participants?.testEmailAddresses ?? [],
    )
  return { target, values }
}

export function prepareApplicationRuntime(name, directory, options = {}) {
  const { target, values } = resolveApplicationSettings(
    name,
    directory,
    options,
  )
  for (const [app, settings] of Object.entries(values)) {
    const credentialKey = SERVICE_CREDENTIAL_KEYS[app]
    if (!credentialKey || !settings[credentialKey]) continue
    settings.GOOGLE_APPLICATION_CREDENTIALS = materializeServiceCredential(
      directory,
      target,
      app,
      settings[credentialKey],
    )
    delete settings[credentialKey]
  }
  return { target, values }
}

export function validateTargetValues(target, values) {
  for (const [app, env] of Object.entries(values)) {
    if (env.GCP_PROJECT_ID && env.GCP_PROJECT_ID !== target.project)
      throw new Error(`${app}: project mismatch`)
    assertEnvironmentSafety(env)
  }
}

export function checkApplication(app, env, environment) {
  assertEnvironmentSafety({ ...env, AERPP_ENVIRONMENT: environment })
  if (app === "support") readSupportEnvironment(env)
  if (app === "web") {
    requireConfigured(
      env,
      [
        "SUPPORT_API_CREDENTIAL",
        "PARTICIPANT_API_SERVER_ID",
        "IDENTIFIER_HASH_SECRET",
        "SESSION_SEAL_PASSWORD",
      ],
      app,
    )
    const errors = validateWebEnvironment(env, {
      webDirectory: resolve(ROOT, "apps/web"),
    })
    if (errors.length)
      throw new Error(
        `Web environment contract validation failed: ${errors.join("; ")}`,
      )
    if (environment === "production" && env.DEBUG_PAGES_ENABLED !== "false")
      throw new Error("Disable production Web debug pages")
  }
  if (app === "admin") {
    readAdminEnvironment(env)
    requireConfigured(
      env,
      [
        "PARTICIPANT_API_SERVER_ID",
        "NEXTAUTH_URL",
        "NEXTAUTH_SECRET",
        "SESSION_SEAL_PASSWORD",
        "IDENTIFIER_HASH_SECRET",
        "ADMIN_GOOGLE_OAUTH_CLIENT_ID",
        "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET",
        "ADMIN_ALLOWED_EMAILS",
      ],
      app,
    )
    if (
      !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(
        env.ADMIN_GOOGLE_OAUTH_CLIENT_ID,
      )
    )
      throw new Error(
        "Invalid Admin Google OAuth client ID; set the full Web client ID manually",
      )
    if (
      env.ADMIN_AUTH_BYPASS_ENABLED &&
      env.ADMIN_AUTH_BYPASS_ENABLED !== "false"
    )
      throw new Error("Cloud-connected admin must not skip authentication")
    try {
      const url = new URL(env.NEXTAUTH_URL)
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(
            environment === "test" &&
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)
          ))
      )
        throw new Error()
    } catch {
      throw new Error("Invalid admin NEXTAUTH_URL for this environment")
    }
  }
}
export function checkCredential(file, project, label, expectedEmail) {
  if (!file || !isAbsolute(file))
    throw new Error(
      `${label}: set an absolute GOOGLE_APPLICATION_CREDENTIALS path`,
    )
  const credential = readJson(file, `${label} credential JSON`)
  if (
    credential.type !== "service_account" ||
    credential.project_id !== project ||
    typeof credential.client_email !== "string" ||
    !credential.client_email.endsWith(`@${project}.iam.gserviceaccount.com`) ||
    (expectedEmail && credential.client_email !== expectedEmail)
  )
    throw new Error(`${label}: credential project mismatch`)
}
export function checkEnvironment(name, directory, projects, selectedApp) {
  const { target, values } = prepareApplicationRuntime(name, directory, {
    projects: projects,
    apps: selectedApp,
  })
  validateTargetValues(target, values)
  for (const [app, env] of Object.entries(values))
    checkApplication(app, env, name)
  for (const app of ["logging"])
    if (values[app])
      checkCredential(
        values[app].GOOGLE_APPLICATION_CREDENTIALS,
        target.project,
        app,
        readAutoSettings(directory, target).serviceAccounts?.logging,
      )
}

export function generateEnvironment(
  name,
  directory,
  projects,
  output = generatedEnvironmentDirectory(name),
  selectedApp,
) {
  const { target, values } = prepareApplicationRuntime(name, directory, {
    projects: projects,
    apps: selectedApp,
  })
  validateTargetValues(target, values)
  const files = Object.fromEntries(
    Object.entries(values).map(([app, env]) => [
      `${app}.json`,
      `${JSON.stringify(env, null, 2)}\n`,
    ]),
  )
  mkdirSync(output, { recursive: true, mode: 0o700 })
  for (const [file, contents] of Object.entries(files)) {
    const temporary = resolve(output, `.${file}.${process.pid}.tmp`)
    writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" })
    renameSync(temporary, resolve(output, file))
  }
}
