import {
  CODE_TITLES,
  EVENT_TITLES,
  HTTP_STATUS_TITLES,
  OPERATION_TITLES,
  SERVICE_LABELS,
} from "@/lib/cloud-logging-catalog"
import type { OperationalLogEntry } from "@/lib/cloud-logging-types"
import type {
  OperationalEvent,
  OperationalGroup,
} from "./operational-log-types"

export { SERVICE_LABELS } from "@/lib/cloud-logging-catalog"

export function describeOperationalEvent(
  entry: OperationalLogEntry,
): OperationalEvent {
  // Unknown strings are never rendered; platform/proxy payloads may contain private data.
  const event =
    entry.event !== null && Object.hasOwn(EVENT_TITLES, entry.event) === true
      ? entry.event
      : null
  const operation =
    entry.operation !== null &&
    Object.hasOwn(OPERATION_TITLES, entry.operation) === true
      ? entry.operation
      : null
  const code =
    entry.code !== null && Object.hasOwn(CODE_TITLES, entry.code) === true
      ? entry.code
      : null
  const expectedCode =
    code === "ADMISSION_CLOSED" ||
    code === "WITHDRAWAL_CLEANUP_PENDING" ||
    code === "MAINTENANCE_OUTSIDE_WINDOW"
  const rejected =
    entry.outcome === "rejected" ||
    event === "http.request.rejected" ||
    event === "step_state.validation.rejected" ||
    event === "llm.analysis.rejected" ||
    (event === "dependency.request.failed" &&
      entry.statusCode !== null &&
      entry.statusCode >= 400 &&
      entry.statusCode < 500 &&
      entry.statusCode !== 429)
  const aborted =
    entry.outcome === "aborted" || event === "llm.analysis.aborted"
  const retry =
    event === "dependency.request.retried" || entry.outcome === "retrying"
  const systemFailure =
    entry.severity === "ERROR" ||
    entry.severity === "CRITICAL" ||
    (entry.statusCode !== null && entry.statusCode >= 500) ||
    (entry.counts.failed ?? 0) > 0
  const needsAttention =
    systemFailure === true ||
    entry.severity === "WARNING" ||
    entry.outcome === "failed" ||
    entry.outcome === "partial" ||
    event?.endsWith(".failed") === true
  const expected =
    expectedCode === true ||
    (systemFailure !== true && (rejected === true || aborted === true))
  const title =
    (code === "MAIL_REAUTHORIZATION_REQUIRED"
      ? CODE_TITLES[code]
      : undefined) ??
    (event !== null ? EVENT_TITLES[event] : undefined) ??
    (operation !== null ? OPERATION_TITLES[operation] : undefined) ??
    (entry.statusCode !== null
      ? (HTTP_STATUS_TITLES[entry.statusCode] ??
        (entry.statusCode >= 500
          ? "要求処理の失敗"
          : entry.statusCode >= 400
            ? "要求の拒否"
            : undefined))
      : undefined) ??
    `${SERVICE_LABELS[entry.service]} の運用記録`
  const kind =
    retry === true
      ? "retry"
      : needsAttention === true && expected !== true
        ? "attention"
        : "activity"
  const result =
    code !== null
      ? CODE_TITLES[code]
      : kind === "attention"
        ? "要確認"
        : kind === "retry"
          ? "再試行"
          : aborted === true
            ? "中断"
            : rejected === true
              ? "拒否"
              : entry.outcome === "completed" || entry.outcome === "succeeded"
                ? "完了"
                : entry.outcome === "accepted"
                  ? "受付"
                  : entry.outcome === "started"
                    ? "開始"
                    : entry.severity === "WARNING"
                      ? "警告"
                      : "記録"
  return {
    entry,
    title,
    kind,
    result,
    key: JSON.stringify([
      entry.service,
      event,
      operation,
      code,
      kind,
      entry.statusCode,
    ]),
  }
}

export function buildOperationalSummary(entries: OperationalLogEntry[]) {
  const events = entries
    .map(describeOperationalEvent)
    .sort((a, b) =>
      (b.entry.timestamp ?? "").localeCompare(a.entry.timestamp ?? ""),
    )
  const groups = new Map<string, OperationalGroup>()
  for (const item of events.filter((event) => event.kind === "attention")) {
    const current = groups.get(item.key)
    if (current) {
      current.count++
      if (item.entry.timestamp !== null) current.firstAt = item.entry.timestamp
    } else {
      groups.set(item.key, {
        key: item.key,
        service: item.entry.service,
        title: item.title,
        result: item.result,
        count: 1,
        firstAt: item.entry.timestamp,
        lastAt: item.entry.timestamp,
        event:
          item.entry.event !== null &&
          Object.hasOwn(EVENT_TITLES, item.entry.event) === true
            ? item.entry.event
            : null,
        operation:
          item.entry.operation !== null &&
          Object.hasOwn(OPERATION_TITLES, item.entry.operation) === true
            ? item.entry.operation
            : null,
        code:
          item.entry.code !== null &&
          Object.hasOwn(CODE_TITLES, item.entry.code) === true
            ? item.entry.code
            : null,
        statusCode: item.entry.statusCode,
      })
    }
  }
  return {
    attention: [...groups.values()],
    events,
    retryCount: events.filter((item) => item.kind === "retry").length,
  }
}

export function maintenanceResult(
  entry: OperationalLogEntry | undefined,
): string {
  if (!entry) return "記録を確認できません"
  if (entry.code === "MAINTENANCE_OUTSIDE_WINDOW") return "対象期間外のスキップ"
  if (describeOperationalEvent(entry).kind === "attention")
    return "失敗・要確認"
  if (entry.code === "MAINTENANCE_COMPLETED")
    return (entry.counts.pending ?? 0) > 0 ? "完了（処理持越しあり）" : "完了"
  return "結果未確認"
}
