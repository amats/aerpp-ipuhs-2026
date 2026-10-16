// Retry-After may be either delta seconds or an HTTP date. Never shorten it.
export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (value === null) return 0
  const trimmed = value.trim()
  const milliseconds = /^\d+$/.test(trimmed)
    ? Number(trimmed) * 1000
    : Date.parse(trimmed) - now
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0
}
