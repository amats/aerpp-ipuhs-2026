import { resolveDataPurposeFilter } from "@aerpp/firestore/data-purpose-types"
import {
  getConfiguredServerId,
  loadAnalysisAttempts,
  loadParticipationEventRecords,
  loadSurveyRecords,
} from "@/features/monitoring/participant-records"
import { listOperationalLogs, parseLogPeriodDays } from "@/lib/cloud-logging"
import { loadPageData } from "@/lib/load-page-data"
import { buildOperationalSummary } from "./operational-log-summary"
import { buildOperationalUsage } from "./operational-usage"

export async function loadOperationalPageData(
  input: { period?: unknown; dataPurpose?: unknown },
  now = new Date(),
) {
  const periodDays = parseLogPeriodDays(input.period)
  const dataPurpose = resolveDataPurposeFilter(input.dataPurpose)
  const serverId = getConfiguredServerId()
  const since = new Date(now.getTime() - periodDays * 86_400_000)
  const [logs, usage] = await Promise.all([
    listOperationalLogs(periodDays, now),
    loadPageData("loadOperationalUsage", async () => {
      const [events, attempts, surveys] = await Promise.all([
        loadParticipationEventRecords(serverId, dataPurpose),
        loadAnalysisAttempts(serverId, dataPurpose),
        loadSurveyRecords(serverId, dataPurpose, [], { includeAnswers: false }),
      ])
      return buildOperationalUsage({
        events,
        attempts,
        surveys,
        since,
        until: now,
      })
    }),
  ])
  return {
    filters: { periodDays, dataPurpose, serverId },
    loadedAt: now.toISOString(),
    logs,
    usage,
    summary: buildOperationalSummary(logs.entries),
  }
}
