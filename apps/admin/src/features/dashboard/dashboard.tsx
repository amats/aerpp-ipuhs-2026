import Link from "next/link"
import DataLoadError from "@/features/app-shell/data-load-error"
import CloudConsoleLinks from "@/features/dashboard/cloud-console-links"
import { loadDashboardData } from "@/features/dashboard/load-dashboard-data"
import InformationNotices from "@/features/information/information-notices"
import OperationalAttention from "@/features/log/operational-attention"
import { formatDateTime } from "@/features/monitoring/participant-records"
import { requireAdminSession } from "@/lib/auth"
import { loadPageData } from "@/lib/load-page-data"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

function SummaryMetric({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 p-4 dark:border-white/10 dark:bg-slate-950/40">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-3xl font-bold text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </div>
  )
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminSession("/dashboard")
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const result = await loadPageData("loadDashboardData", () =>
    loadDashboardData({ dataPurpose: resolvedSearchParams?.dataPurpose }),
  )
  if (!result.ok) return <DataLoadError />
  const data = result.data

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Overview"
        title="参加状況と運用上の要対応事項をまとめて確認"
      />

      <InformationNotices
        records={data.information}
        error={data.informationError}
      />

      <CardPanel as="section" className="flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <SectionHeading eyebrow="Analysis" title="解析の実行状況" />
          <Link
            href={`/survey?dataPurpose=${data.filters.dataPurpose}`}
            className="shrink-0 text-sm font-semibold text-(--brand)"
          >
            詳細へ
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryMetric
            label="解析開始回数"
            value={data.attemptCounts.total}
          />
          <SummaryMetric
            label="解析完了"
            value={data.attemptCounts.completed}
          />
          <SummaryMetric label="失敗" value={data.attemptCounts.failed} />
          <SummaryMetric label="中断" value={data.attemptCounts.cancelled} />
          <SummaryMetric
            label="終了未確認"
            value={data.attemptCounts.unconfirmed}
          />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          選択中のデータ区分・サーバーの保持された実行記録を集計しています。終了未確認には実行中や通信切断を含みます。解析完了はアンケート回答とは別に集計しています。
        </p>
      </CardPanel>

      <div className="grid gap-5 xl:grid-cols-2">
        <CardPanel className="flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <SectionHeading eyebrow="Participants" title="参加者" />
            <Link
              href={`/participant?dataPurpose=${data.filters.dataPurpose}`}
              className="text-sm font-semibold text-(--brand)"
            >
              詳細へ
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryMetric
              label="最新状態の人数"
              value={data.participantSummary.trackedParticipants}
            />
            <SummaryMetric
              label="同意履歴レコード"
              value={data.participantSummary.totalRecords}
            />
          </div>
          <div className="grid gap-3">
            {data.participantSummary.latestStatusCounts.map((item) => (
              <div
                key={item.eventType}
                className="flex items-center justify-between rounded-2xl border border-slate-200/80 px-4 py-3 dark:border-white/10"
              >
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {item.eventType}
                </span>
                <span className="text-lg font-bold text-slate-950 dark:text-slate-100">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </CardPanel>

        <CardPanel className="flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <SectionHeading eyebrow="Surveys" title="アンケート結果" />
            <Link
              href={`/survey?dataPurpose=${data.filters.dataPurpose}`}
              className="text-sm font-semibold text-(--brand)"
            >
              詳細へ
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryMetric
              label="記録済み解析完了件数"
              value={data.surveySummary.totalAnalyses}
            />
            <SummaryMetric
              label="全回答数"
              value={data.surveySummary.totalResponses}
            />
            <SummaryMetric
              label="回答者数"
              value={data.surveySummary.uniqueParticipants}
            />
          </div>
        </CardPanel>

        <CardPanel className="flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <SectionHeading eyebrow="Latest" title="参加・回答履歴" />
            <Link
              href={`/updates?dataPurpose=${data.filters.dataPurpose}`}
              className="shrink-0 text-sm font-semibold text-(--brand)"
            >
              詳細へ
            </Link>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            参加者・アンケートの直近の更新を最大4件表示します。
          </p>
          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              参加・回答の履歴はありません。
            </p>
          ) : (
            <div className="space-y-3">
              {data.recentActivity.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200/80 px-4 py-3 wrap-anywhere dark:border-white/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      {item.category} / {item.serverId}
                    </span>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardPanel>

        <CardPanel className="flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-4">
            <SectionHeading eyebrow="Operations" title="要対応事項" />
            <Link
              href={`/log?dataPurpose=${data.filters.dataPurpose}`}
              className="text-sm font-semibold text-(--brand)"
            >
              運用状況へ
            </Link>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            直近1日の環境全体の運用ログから確認対象を表示します。
          </p>
          <OperationalAttention
            groups={data.attention}
            error={data.operationalLogs.error}
            truncated={data.operationalLogs.truncated}
            since={data.operationalLogs.since}
            until={data.operationalLogs.until}
            limit={4}
          />
        </CardPanel>
      </div>

      <CloudConsoleLinks />
    </CardSection>
  )
}
