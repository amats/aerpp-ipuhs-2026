export const OAUTH_CREDENTIAL_KEYS = Object.freeze({
  admin: "ADMIN_GOOGLE_OAUTH_CLIENT_JSON",
  support: "SUPPORT_GMAIL_OAUTH_CLIENT_JSON",
})

export function parseOAuthCredential(value, project, app) {
  const client = value?.web
  if (
    !Object.hasOwn(OAUTH_CREDENTIAL_KEYS, app) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.hasOwn(value, "installed") ||
    !client ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    client.project_id !== project ||
    typeof client.client_id !== "string" ||
    !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(client.client_id) ||
    typeof client.client_secret !== "string" ||
    !client.client_secret.trim() ||
    /^(YOUR_|replace[-_ ]with)/i.test(client.client_secret.trim())
  )
    throw new Error(
      `${app}: paste the downloaded Web application OAuth JSON for the selected project into secret.json`,
    )
  return { clientId: client.client_id, clientSecret: client.client_secret }
}

export function projectOAuthCredentials(config, target, provider, apps) {
  const derived = {}
  for (const app of apps.filter((app) =>
    Object.hasOwn(OAUTH_CREDENTIAL_KEYS, app),
  )) {
    if (target.name === "example") continue
    const section = app === "admin" ? config.admin : config.support?.gmail
    const keys =
      app === "admin"
        ? ["ADMIN_GOOGLE_OAUTH_CLIENT_ID", "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET"]
        : ["clientId", "clientSecret"]
    if (keys.some((key) => Object.hasOwn(section ?? {}, key)))
      throw new Error(
        `${app}: remove split OAuth client settings from config.json; use secret.json ${OAUTH_CREDENTIAL_KEYS[app]}`,
      )
    const client = parseOAuthCredential(
      provider.getJsonSecret(OAUTH_CREDENTIAL_KEYS[app]),
      target.project,
      app,
    )
    if (!section)
      throw new Error(`${app}: configure the selected application section`)
    const secretKey =
      app === "admin"
        ? "ADMIN_GOOGLE_OAUTH_CLIENT_SECRET"
        : "SUPPORT_GMAIL_CLIENT_SECRET"
    section[keys[0]] = client.clientId
    section[keys[1]] = { secret: secretKey }
    derived[secretKey] = client.clientSecret
  }
  return {
    ...provider,
    getSecret: (name) =>
      Object.hasOwn(derived, name) ? derived[name] : provider.getSecret(name),
  }
}
