import type {
  AnalysisAttemptRecord,
  ParticipationEventRecord,
  SurveyRecord,
} from "@/features/monitoring/participant-record-types"
import type { OperationalUsage, UsageCounts } from "./operational-log-types"

export const USAGE_LABELS: Record<keyof UsageCounts, string> = {
  consents: "同意確認",
  withdrawals: "撤回受付",
  starts: "解析開始",
  completed: "解析完了",
  failed: "解析失敗",
  cancelled: "解析中断",
  unconfirmed: "終了未確認",
  analyses: "解析完了の記録",
  responses: "アンケート提出",
}
export const USAGE_KEYS = Object.keys(USAGE_LABELS) as Array<keyof UsageCounts>

function emptyCounts(): UsageCounts {
  return {
    consents: 0,
    withdrawals: 0,
    starts: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    unconfirmed: 0,
    analyses: 0,
    responses: 0,
  }
}
function japanDay(date: Date): string {
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

export function buildOperationalUsage(input: {
  events: ParticipationEventRecord[]
  attempts: AnalysisAttemptRecord[]
  surveys: SurveyRecord[]
  since: Date
  until: Date
}): OperationalUsage {
  const counts = emptyCounts()
  const daily = new Map<string, UsageCounts>()
  for (
    let time = Date.parse(`${japanDay(input.since)}T00:00:00+09:00`);
    time <= input.until.getTime();
    time += 86_400_000
  )
    daily.set(japanDay(new Date(time)), emptyCounts())
  let unknownDates = 0
  function add(date: Date | null, keys: Array<keyof UsageCounts>) {
    if (date === null) {
      unknownDates++
      return
    }
    if (
      date.getTime() < input.since.getTime() ||
      date.getTime() > input.until.getTime()
    )
      return
    const row = daily.get(japanDay(date))
    if (!row) return
    for (const key of keys) {
      counts[key]++
      row[key]++
    }
  }
  for (const event of input.events) {
    if (event.eventType === "consent") add(event.eventAt, ["consents"])
    else if (event.eventType === "withdrawal")
      add(event.eventAt, ["withdrawals"])
  }
  // Outcomes belong to the attempts started in the window, not completions in the window.
  for (const attempt of input.attempts)
    add(attempt.startedAt, ["starts", attempt.outcome])
  for (const survey of input.surveys) {
    add(survey.createdAt, ["analyses"])
    if (survey.submittedAt !== null) add(survey.submittedAt, ["responses"])
  }
  return {
    counts,
    daily: [...daily].map(([date, row]) => ({ date, counts: row })),
    unknownDates,
  }
}
