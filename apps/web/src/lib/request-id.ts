const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/

export const REQUEST_ID_HEADER = "x-request-id"

// Accepts only compact request IDs that are safe to echo into logs and headers.
export function normalizeRequestId(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!REQUEST_ID_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

// Creates a fresh request ID when upstream did not provide a valid one.
export function createRequestId() {
  return crypto.randomUUID()
}
