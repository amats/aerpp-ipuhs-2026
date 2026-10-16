import "server-only"

import { createHash } from "node:crypto"
import { env } from "@aerpp/config/server/web"
import type { NextRequest } from "next/server"
import pino from "pino"
import { formatDevelopmentLog } from "@/lib/logger-development"
import { LOG_EVENT } from "@/lib/logger-events"
import {
  createRequestId,
  normalizeRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/request-id"
import { APP_VERSION } from "@/lib/version"

type SafeScalar = string | number | boolean | null
type SafeContextValue = SafeScalar | undefined

export const LOG_SCHEMA_VERSION = 1

type RequestContext = {
  method?: string
  requestId?: string
  route?: string
  traceId?: string
}

type LoggerBaseContext = {
  component?: string
  method?: string
  operation?: string
  requestId?: string
  route?: string
  traceId?: string
}

type SafeLogContextFields = {
  analysisId: string
  attempt: number
  clientId: string
  component: string
  dependency: string
  documentId: string
  durationMs: number
  invalidCount: number
  pendingCount: number
  blockedCount: number
  oldestAgeMs: number
  issue: string
  maxTotalGraphemes: number
  method: string
  operation: string
  outcome:
    | "accepted"
    | "completed"
    | "failed"
    | "rejected"
    | "retrying"
    | "started"
    | "succeeded"
    | "aborted"
    | "partial"
    | "unconfirmed"
    | "unavailable"
  pseudonym: string
  requestId: string
  responseStatus: number
  retryCount: number
  retryDelayMs: number
  route: string
  rootStep: string
  stage: string
  statusCode: number
  target: string
  timeoutMs: number
  traceId: string
}

export type SafeLogContext = Partial<SafeLogContextFields>

const SAFE_CONTEXT_KEYS = new Set<keyof SafeLogContextFields>([
  "analysisId",
  "attempt",
  "clientId",
  "component",
  "dependency",
  "documentId",
  "durationMs",
  "invalidCount",
  "pendingCount",
  "blockedCount",
  "oldestAgeMs",
  "issue",
  "maxTotalGraphemes",
  "method",
  "operation",
  "outcome",
  "pseudonym",
  "requestId",
  "responseStatus",
  "retryCount",
  "retryDelayMs",
  "route",
  "rootStep",
  "stage",
  "statusCode",
  "target",
  "timeoutMs",
  "traceId",
])

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const SAFE_EVENTS = new Set<string>(Object.values(LOG_EVENT))
const API_TOKEN_PATTERN = /\b(sk|rk|pk)_[A-Za-z0-9_-]+\b/g

// Maps Pino levels to the severity labels expected by log consumers.
export function toLogSeverity(level: string) {
  switch (level) {
    case "trace":
    case "debug":
      return "DEBUG"
    case "info":
      return "INFO"
    case "warn":
      return "WARNING"
    case "error":
      return "ERROR"
    case "fatal":
      return "CRITICAL"
    default:
      return level.toUpperCase()
  }
}

const baseLogger = pino(
  {
    enabled: env.nodeEnv !== "test",
    level: env.logLevel,
    messageKey: "message",
    base: {
      env: env.nodeEnv ?? "development",
      logger: "pino",
      schemaVersion: LOG_SCHEMA_VERSION,
      service: "app-aerpp",
      version: APP_VERSION,
    },
    formatters: {
      level(label) {
        return {
          level: label,
          severity: toLogSeverity(label),
        }
      },
      log(payload) {
        return sanitizeLogPayload(payload)
      },
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    redact: {
      paths: [
        "authorization",
        "body",
        "cookie",
        "cookies",
        "email",
        "encryptedEmail",
        "headers.authorization",
        "headers.cookie",
        "prompt",
        "session",
      ],
      remove: true,
    },
  },
  env.nodeEnv === "development"
    ? {
        write(line: string) {
          process.stdout.write(formatDevelopmentLog(line))
        },
      }
    : undefined,
)

// Hashes sensitive log values with the server key before truncating them.
function hashLogValue(value: string): string {
  return createHash("sha256")
    .update(value)
    .update(env.identifierHashSecret)
    .digest("hex")
    .slice(0, 12)
}

// Uses the shared log hash so identifiers stay correlatable without disclosure.
function hashIdentifier(value: string): string {
  return hashLogValue(value)
}

// Redacts secrets that accidentally land in otherwise allowed string fields.
function maskSecrets(value: string): string {
  if (!value.includes("@") && !value.includes("_")) {
    return value
  }

  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(API_TOKEN_PATTERN, "[redacted-token]")
}

// Restricts structured logs to fields reviewed for operational safety.
function isSafeContextKey(key: string): key is keyof SafeLogContextFields {
  return SAFE_CONTEXT_KEYS.has(key as keyof SafeLogContextFields)
}

// Sanitizes one context value according to its approved field behavior.
function sanitizeContextValue(
  key: string,
  value: SafeContextValue,
): SafeScalar | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isSafeContextKey(key)) {
    return undefined
  }
  if (
    (key === "clientId" || key === "pseudonym") &&
    typeof value === "string"
  ) {
    return hashIdentifier(value)
  }
  if (typeof value === "string") {
    if (
      key === "traceId" &&
      !/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/.test(value)
    )
      return undefined
    return maskSecrets(key === "route" ? value.split("?")[0] : value)
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  return undefined
}

// Filters log context to approved fields and protects sensitive identifiers.
export function sanitizeLogContext(
  context?: SafeLogContext | Record<string, SafeContextValue>,
) {
  if (!context) {
    return undefined
  }
  let sanitized: Record<string, SafeScalar> | undefined

  for (const [key, value] of Object.entries(context)) {
    if (!isSafeContextKey(key)) {
      continue
    }

    const sanitizedValue = sanitizeContextValue(key, value)
    if (sanitizedValue === undefined) {
      continue
    }

    sanitized ??= {}
    sanitized[key] = sanitizedValue
  }

  return sanitized
}

// Applies context filtering to every emitted Pino payload.
function sanitizeLogPayload(payload: Record<string, unknown>) {
  const sanitized = sanitizeLogContext(payload as SafeLogContext) ?? {}

  return {
    ...sanitized,
    ...(payload.error === undefined
      ? {}
      : { error: serializeError(payload.error) }),
    ...(typeof payload.event === "string" &&
    SAFE_EVENTS.has(payload.event) === true
      ? { event: payload.event }
      : {}),
  }
}

// Serializes errors without exposing runtime messages or sensitive values.
export function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: "unknown error", name: "UnknownError" }
  }

  return {
    message: "redacted",
    messageHash: hashLogValue(error.message),
    name: [
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "ReferenceError",
      "URIError",
      "EvalError",
      "AggregateError",
      "AbortError",
      "TimeoutError",
    ].includes(error.name)
      ? error.name
      : "Error",
  }
}

// Creates a child logger after filtering context to approved structured fields.
export function createLogger(context?: LoggerBaseContext) {
  return baseLogger.child(sanitizeLogContext(context) ?? {})
}

export type AppLogger = ReturnType<typeof createLogger>
export type RequestLogger = {
  logger: AppLogger
  requestId: string
}

// Creates a logger preloaded with request metadata and a normalized request ID.
export function createRequestLogger(
  request: Request | NextRequest,
  context: LoggerBaseContext,
): RequestLogger {
  const url = new URL(request.url)
  const requestId =
    normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ??
    createRequestId()

  return {
    logger: createLogger({
      ...context,
      method: request.method,
      requestId,
      route: url.pathname,
      traceId: request.headers.get("traceparent") ?? undefined,
    }),
    requestId,
  }
}

// Emits the standard structured event for rejected route requests.
export function logRouteRejected(
  logger: AppLogger,
  statusCode: number,
  context?: SafeLogContext,
  error?: unknown,
) {
  logger.warn({
    ...context,
    event: LOG_EVENT.routeRequestRejected,
    ...(error === undefined ? {} : { error }),
    outcome: "rejected",
    statusCode,
  })
}

// Extracts the header values used to seed request-scoped logging context.
export function getRequestContextFromHeaders(headers: Headers): RequestContext {
  return {
    requestId:
      normalizeRequestId(headers.get(REQUEST_ID_HEADER)) ?? createRequestId(),
    traceId: headers.get("traceparent") ?? undefined,
  }
}
