export function readOptionalEnvironment(env, key) {
  const value = env[key]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

export function readRequiredEnvironment(env, key) {
  const value = readOptionalEnvironment(env, key)
  if (value === undefined)
    throw new Error(`Missing required environment variable: ${key}`)
  return value
}

// GOOGLE_CLOUD_PROJECT and GCLOUD_PROJECT are injected by Google runtimes/SDKs.
export function resolveGcpProjectId(env) {
  const values = ["GCP_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]
    .map((key) => readOptionalEnvironment(env, key))
    .filter(Boolean)
  if (new Set(values).size > 1)
    throw new Error("Conflicting GCP project configuration")
  return values[0]
}

export function resolveParticipantApiUrl(value) {
  try {
    const url = new URL(value)
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error()
    return url.toString()
  } catch {
    throw new Error(
      "Expected an absolute participant API URL (HTTPS; HTTP only for loopback)",
    )
  }
}
