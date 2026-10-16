import {
  readOptionalEnvironment,
  resolveGcpProjectId,
  resolveParticipantApiUrl,
} from "./index.mjs"

export const ENVIRONMENTS = Object.freeze({
  example: {
    directory: "example",
    kind: "emulator",
    apps: ["web", "support"],
  },
  test: {
    directory: "test",
    kind: "cloud",
    apps: ["web", "admin", "logging", "support"],
  },
  production: {
    directory: "production",
    kind: "cloud",
    apps: ["web", "admin", "logging", "support"],
  },
})

export function environmentDefinition(name) {
  if (!Object.hasOwn(ENVIRONMENTS, name))
    throw new Error("Select environment: example, test or production")
  return ENVIRONMENTS[name]
}

export function isPlaceholder(value) {
  return (
    typeof value !== "string" ||
    !value.trim() ||
    /^(YOUR_|replace[-_ ]with)/i.test(value.trim())
  )
}

export function requireConfigured(env, keys, app) {
  for (const key of keys)
    if (isPlaceholder(env[key]))
      throw new Error(
        `${app}: configure ${key}; placeholder values are not ready`,
      )
}

// Called by runtime adapters as well as launchers; never requires private files.
export function assertEnvironmentSafety(env) {
  const project = resolveGcpProjectId(env)
  const name = readOptionalEnvironment(env, "AERPP_ENVIRONMENT")
  const kind = name ? environmentDefinition(name).kind : undefined
  const emulatorValues = Object.entries(env).filter(
    ([key, value]) =>
      value &&
      (key.endsWith("_EMULATOR_HOST") ||
        key === "AUTH_E2E_EMULATOR" ||
        (key === "FUNCTIONS_EMULATOR" && value !== "false")),
  )
  if (
    kind === "cloud" &&
    (emulatorValues.length || project?.startsWith("demo-"))
  )
    throw new Error("Cloud configuration cannot contain emulator settings")
  if (emulatorValues.length && project && !project.startsWith("demo-"))
    throw new Error("Emulator configuration requires a demo project")
  if (kind === "emulator" && project && !project.startsWith("demo-"))
    throw new Error("Example configuration requires a demo project")
  for (const [key, value] of emulatorValues) {
    if (!key.endsWith("_EMULATOR_HOST")) continue
    try {
      const host =
        key === "CLOUD_EVENTARC_EMULATOR_HOST"
          ? value.replace(/^http:\/\//, "")
          : value
      const url = new URL(`http://${host}`)
      if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || !url.port)
        throw new Error()
    } catch {
      throw new Error(`${key}: expected a loopback host and port`)
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (!value || key !== "SUPPORT_API_BASE_URL") continue
    const url = new URL(resolveParticipantApiUrl(value))
    if (
      kind === "emulator" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error(`${key}: example requires a loopback endpoint`)
    if (kind === "cloud" && url.protocol !== "https:")
      throw new Error(`${key}: cloud requires HTTPS`)
  }
  if (kind === "cloud") {
    for (const [key, value] of Object.entries(env))
      if (typeof value === "string" && value.startsWith("local-example-"))
        throw new Error(
          `${key}: public example values cannot be used in cloud profiles`,
        )
    if (
      env.ADMIN_AUTH_BYPASS_ENABLED &&
      env.ADMIN_AUTH_BYPASS_ENABLED !== "false"
    )
      throw new Error("Cloud-connected admin must not skip authentication")
  }
}
