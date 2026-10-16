// Formats only records already sanitized and serialized by the application logger.
export function formatDevelopmentLog(line: string): string {
  const {
    timestamp,
    level,
    event,
    env: _env,
    logger: _logger,
    schemaVersion: _schemaVersion,
    service: _service,
    severity: _severity,
    version: _version,
    ...context
  } = JSON.parse(line) as Record<string, unknown>
  const heading = `[${timestamp}] ${String(level).toUpperCase().padEnd(5)} ${event ?? "log"}`
  const details = Object.entries(context)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ")

  return `${heading}${details.length > 0 ? `\n  ${details}` : ""}\n`
}
