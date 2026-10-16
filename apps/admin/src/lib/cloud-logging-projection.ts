import type { Entry } from "@google-cloud/logging"
import {
  CODE_TITLES,
  EVENT_TITLES,
  OPERATION_TITLES,
} from "./cloud-logging-catalog"
import type {
  OperationalLogEntry,
  OperationalService,
} from "./cloud-logging-types"
import { dateMillis } from "./record-time"

function timestampIso(value: unknown): string | null {
  // Cloud Logging protobuf timestamps use nanos and may encode seconds as strings.
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds =
      typeof value.seconds === "string" ? Number(value.seconds) : value.seconds
    value = { seconds, nanoseconds: "nanos" in value ? value.nanos : 0 }
  }
  const milliseconds = dateMillis(value)
  return milliseconds === null ? null : new Date(milliseconds).toISOString()
}

function cataloguedToken(
  value: unknown,
  catalog: Record<string, string>,
): string | null {
  return typeof value === "string" && Object.hasOwn(catalog, value) === true
    ? value
    : null
}

function serviceOf(entry: Entry): OperationalService {
  const resource = entry.metadata.resource
  if (resource?.type === "cloud_scheduler_job") return "scheduler"
  if (resource?.type === "cloud_run_revision")
    return entry.metadata.labels?.["aerpp-component"] === "admin"
      ? "admin"
      : "support"
  return entry.metadata.labels?.component === "caddy" ? "proxy" : "web"
}

export function toOperationalLogEntry(
  entry: Entry,
  index: number,
): OperationalLogEntry {
  const data: Record<string, unknown> =
    typeof entry.data === "object" && entry.data !== null ? entry.data : {}
  const rawSeverity = entry.metadata.severity
  const proxyLevel = typeof data.level === "string" ? data.level : null
  const severity =
    rawSeverity === "CRITICAL" ||
    rawSeverity === "ALERT" ||
    rawSeverity === "EMERGENCY" ||
    (typeof rawSeverity === "number" && rawSeverity >= 600) ||
    proxyLevel === "fatal"
      ? "CRITICAL"
      : rawSeverity === "ERROR" || rawSeverity === 500 || proxyLevel === "error"
        ? "ERROR"
        : rawSeverity === "WARNING" ||
            rawSeverity === 400 ||
            proxyLevel === "warn"
          ? "WARNING"
          : rawSeverity === "INFO" || rawSeverity === 200
            ? "INFO"
            : "DEFAULT"
  const counts: OperationalLogEntry["counts"] = {}
  for (const key of [
    "scanned",
    "completed",
    "pending",
    "superseded",
    "failed",
  ] as const) {
    const count = data[key]
    if (
      typeof count === "number" &&
      Number.isSafeInteger(count) === true &&
      count >= 0
    )
      counts[key] = count
  }
  const status =
    data.statusCode ??
    data.responseStatus ??
    data.status ??
    entry.metadata.httpRequest?.status
  return {
    id: `${index}-${timestampIso(entry.metadata.timestamp) ?? "unknown"}`,
    timestamp: timestampIso(entry.metadata.timestamp),
    service: serviceOf(entry),
    severity,
    // Never carry messages, bodies, URLs, identifiers or arbitrary nested payloads to the UI.
    event: cataloguedToken(data.event, EVENT_TITLES),
    operation: cataloguedToken(data.operation, OPERATION_TITLES),
    code: cataloguedToken(data.code, CODE_TITLES),
    outcome: [
      "accepted",
      "completed",
      "failed",
      "rejected",
      "retrying",
      "started",
      "succeeded",
      "aborted",
      "partial",
    ].includes(typeof data.outcome === "string" ? data.outcome : "")
      ? (data.outcome as string)
      : null,
    statusCode:
      typeof status === "number" &&
      Number.isInteger(status) === true &&
      status >= 100 &&
      status <= 599
        ? status
        : null,
    counts,
  }
}
