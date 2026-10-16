const GENERATION =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export const SESSION_COOKIE_PREFIX = "aerpp-session-"

export function isSessionGeneration(value: unknown): value is string {
  return typeof value === "string" && GENERATION.test(value)
}

export function sessionCookieName(generation: string) {
  if (!isSessionGeneration(generation))
    throw new Error("Invalid session generation")
  return `${SESSION_COOKIE_PREFIX}${generation}`
}

export function readTabGeneration(token: unknown) {
  if (typeof token !== "string") return null
  const parts = token.split(":")
  return (parts.length === 2 ||
    (parts.length === 3 && parts[2].length <= 32_768)) &&
    isSessionGeneration(parts[0]) &&
    /^[a-f0-9]{64}$/.test(parts[1])
    ? parts[0]
    : null
}

export function createTabId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
