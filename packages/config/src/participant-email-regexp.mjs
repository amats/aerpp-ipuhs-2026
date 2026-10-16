// Match Web's pattern syntax and flag normalization; cloud mail requires an explicit policy.
export function participantEmailRegexp(pattern) {
  if (typeof pattern !== "string" || pattern.trim() === "")
    throw new Error("Configure web.nextPublicParticipantEmailPattern")
  const trimmed = pattern.trim()
  const lastSlash = trimmed.lastIndexOf("/")
  const delimited = trimmed.startsWith("/") === true && lastSlash > 0
  return new RegExp(
    delimited === true ? trimmed.slice(1, lastSlash) : trimmed,
    delimited === true
      ? trimmed.slice(lastSlash + 1).replaceAll(/[dgimsuvy]/g, "")
      : "",
  )
}
