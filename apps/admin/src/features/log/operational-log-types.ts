import type {
  OperationalLogEntry,
  OperationalService,
} from "@/lib/cloud-logging-types"

export type OperationalEvent = {
  entry: OperationalLogEntry
  title: string
  kind: "attention" | "retry" | "activity"
  result: string
  key: string
}

export type OperationalGroup = {
  key: string
  service: OperationalService
  title: string
  result: string
  count: number
  firstAt: string | null
  lastAt: string | null
  event: string | null
  operation: string | null
  code: string | null
  statusCode: number | null
}

export type UsageCounts = {
  consents: number
  withdrawals: number
  starts: number
  completed: number
  failed: number
  cancelled: number
  unconfirmed: number
  analyses: number
  responses: number
}

export type OperationalUsage = {
  counts: UsageCounts
  daily: Array<{ date: string; counts: UsageCounts }>
  unknownDates: number
}
