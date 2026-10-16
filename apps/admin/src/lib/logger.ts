import "server-only"

import pino from "pino"

const logger = pino({
  base: { app: "admin" },
  messageKey: "message",
  formatters: {
    level: (label) => ({
      severity:
        label === "warn"
          ? "WARNING"
          : label === "fatal"
            ? "CRITICAL"
            : label.toUpperCase(),
    }),
  },
})

// SDK text, stacks and nested fields may contain credentials or participant data.
// Only an allowlisted numeric status crosses this diagnostic boundary.
export function logAuthenticationFailure() {
  logger.error(
    { operation: "authenticateAdmin", code: "AUTHENTICATION_FAILED" },
    "Admin authentication failed",
  )
}

export function logAuthenticationWarning() {
  logger.warn(
    { operation: "authenticateAdmin", code: "AUTHENTICATION_WARNING" },
    "Admin authentication needs attention",
  )
}

export function logCloudLoggingFailure(error: unknown) {
  logDataFailure("listOperationalLogs", error)
}

export function logExportFailure(error: unknown) {
  logDataFailure("exportParticipantData", error)
}

export function logPageDataFailure(
  operation:
    | "loadDashboardData"
    | "loadParticipantPageData"
    | "loadSurveyPageData"
    | "loadActivityPageData"
    | "loadOperationalUsage",
  error: unknown,
) {
  logDataFailure(operation, error)
}

export function logInformationFailure(
  operation:
    | "listInformation"
    | "addInformation"
    | "updateInformation"
    | "deleteInformation",
  error: unknown,
) {
  logDataFailure(operation, error)
}

export function logParticipationRecoveryFailure(error: unknown) {
  logDataFailure("authorizeParticipationRecovery", error)
}

export function logRecoveryLookupFailure(error: unknown) {
  logDataFailure("lookupParticipationRecovery", error)
}

function logDataFailure(operation: string, error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined
  const status =
    typeof code === "number" &&
    Number.isInteger(code) &&
    ((code >= 0 && code <= 16) || (code >= 100 && code <= 599))
      ? code
      : undefined

  logger.error(
    { operation, status },
    operation === "listOperationalLogs"
      ? "Cloud Logging request failed"
      : "Data request failed",
  )
}

export function logDocumentReissueFailure(error: unknown) {
  logDataFailure("reissueParticipantDocument", error)
}
