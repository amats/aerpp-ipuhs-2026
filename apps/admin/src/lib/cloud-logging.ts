import "server-only"

import { Logging } from "@google-cloud/logging"
import { googleClientOptions } from "@/lib/google-auth"
import { logCloudLoggingFailure } from "@/lib/logger"
import {
  buildOperationalLogFilter,
  OPERATIONAL_SERVICE_FILTERS,
} from "./cloud-logging-filter"
import { toOperationalLogEntry } from "./cloud-logging-projection"
import type {
  OperationalLogEntry,
  OperationalLogs,
} from "./cloud-logging-types"

const LOG_PAGE_SIZE = 200
const MAX_LOG_PAGES = 5
const LOG_FAILURE_MESSAGE =
  "Cloud Logging を取得できませんでした。時間をおいて再試行してください。"
const MAINTENANCE_OPERATIONS = ["withdrawalCleanup", "mailHealth"] as const

export function parseLogPeriodDays(rawPeriod: unknown): number {
  return rawPeriod === "7" ? 7 : rawPeriod === "30" ? 30 : 1
}

export async function listOperationalLogs(
  days: number,
  now = new Date(),
): Promise<OperationalLogs> {
  const until = now.toISOString()
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const empty = {
    entries: [],
    maintenanceEntries: [],
    truncated: false,
    since,
    until,
  }
  if (googleClientOptions.projectId?.startsWith("demo-") === true) {
    const error = "ローカル検証環境では Cloud Logging を利用しません。"
    return { ...empty, error, maintenanceError: error }
  }
  try {
    const client = new Logging(googleClientOptions)
    const projectId =
      googleClientOptions.projectId ?? (await client.auth.getProjectId())
    if (!projectId) {
      const error =
        "プロジェクト設定がないため、Cloud Logging を取得できません。"
      return { ...empty, error, maintenanceError: error }
    }
    const filter = buildOperationalLogFilter(since, until)
    const baseQuery = {
      orderBy: "timestamp desc",
      resourceNames: [`projects/${projectId}`],
      autoPaginate: false,
      gaxOptions: { timeout: 10_000, retry: null },
    }
    // Latest maintenance results have dedicated queries so busy application logs cannot hide them.
    const [events, maintenance] = await Promise.all([
      (async () => {
        try {
          const entries: OperationalLogEntry[] = []
          let pageToken: string | undefined
          for (let page = 0; page < MAX_LOG_PAGES; page++) {
            const [batch, nextQuery, response] = await client.getEntries({
              ...baseQuery,
              filter,
              pageSize: LOG_PAGE_SIZE,
              pageToken,
            })
            for (const entry of batch)
              entries.push(toOperationalLogEntry(entry, entries.length))
            pageToken =
              nextQuery?.pageToken || response?.nextPageToken || undefined
            if (!pageToken) break
          }
          return { entries, truncated: pageToken !== undefined, error: null }
        } catch (error) {
          logCloudLoggingFailure(error)
          return { entries: [], truncated: false, error: LOG_FAILURE_MESSAGE }
        }
      })(),
      (async () => {
        const results = await Promise.all(
          MAINTENANCE_OPERATIONS.map(async (operation) => {
            try {
              let pageToken: string | undefined
              for (let page = 0; page < MAX_LOG_PAGES; page++) {
                const [entries, nextQuery, response] = await client.getEntries({
                  ...baseQuery,
                  pageSize: 1,
                  pageToken,
                  filter: `${filter} AND ${OPERATIONAL_SERVICE_FILTERS.support} AND jsonPayload.operation="${operation}" AND (jsonPayload.code=("MAINTENANCE_COMPLETED" OR "MAINTENANCE_OUTSIDE_WINDOW") OR severity>=ERROR)`,
                })
                if (entries.length > 0)
                  return {
                    entry: toOperationalLogEntry(entries[0], 0),
                    error: null,
                  }
                pageToken =
                  nextQuery?.pageToken || response?.nextPageToken || undefined
                if (!pageToken) return { entry: null, error: null }
              }
              // An empty page with a continuation token is not an absent result.
              return { entry: null, error: LOG_FAILURE_MESSAGE }
            } catch (error) {
              logCloudLoggingFailure(error)
              return { entry: null, error: LOG_FAILURE_MESSAGE }
            }
          }),
        )
        return {
          maintenanceEntries: results.flatMap((result) =>
            result.entry === null ? [] : [result.entry],
          ),
          maintenanceError:
            results.find((result) => result.error !== null)?.error ?? null,
        }
      })(),
    ])
    return { since, until, ...events, ...maintenance }
  } catch (error) {
    logCloudLoggingFailure(error)
    return {
      ...empty,
      error: LOG_FAILURE_MESSAGE,
      maintenanceError: LOG_FAILURE_MESSAGE,
    }
  }
}
