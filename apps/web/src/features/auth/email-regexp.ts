// Keep the direct public env read so Next.js can inline it in client builds.
const EMAIL_PATTERN =
  process.env.NEXT_PUBLIC_PARTICIPANT_EMAIL_PATTERN?.trim() ||
  "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"

function normalizeRegexpPattern(pattern: string): {
  source: string
  flags: string
} {
  const trimmed = pattern.trim()
  if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const lastSlash = trimmed.lastIndexOf("/")
    return {
      source: trimmed.slice(1, lastSlash),
      flags: trimmed.slice(lastSlash + 1),
    }
  }
  return { source: trimmed, flags: "" }
}

const NORMALIZED_EMAIL_PATTERN = normalizeRegexpPattern(EMAIL_PATTERN)

export const EMAIL_REGEXP = new RegExp(
  NORMALIZED_EMAIL_PATTERN.source,
  NORMALIZED_EMAIL_PATTERN.flags.replaceAll(/[dgimsuvy]/g, ""),
)
