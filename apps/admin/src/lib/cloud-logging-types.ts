export type OperationalService =
  | "web"
  | "support"
  | "admin"
  | "scheduler"
  | "proxy"

export type OperationalLogEntry = {
  id: string
  timestamp: string | null
  service: OperationalService
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "DEFAULT"
  event: string | null
  operation: string | null
  code: string | null
  outcome: string | null
  statusCode: number | null
  counts: Partial<
    Record<
      "scanned" | "completed" | "pending" | "superseded" | "failed",
      number
    >
  >
}

export type OperationalLogs = {
  entries: OperationalLogEntry[]
  maintenanceEntries: OperationalLogEntry[]
  truncated: boolean
  error: string | null
  maintenanceError: string | null
  since: string
  until: string
}
