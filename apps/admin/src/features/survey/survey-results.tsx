import { DATA_PURPOSE_LABELS } from "@aerpp/firestore/data-purpose-types"
import DataLoadError from "@/features/app-shell/data-load-error"
import {
  ANALYSIS_OUTCOME_LABELS,
  formatDateTime,
} from "@/features/monitoring/participant-records"
import RecentActivityList from "@/features/monitoring/recent-activity-list"
import AnalysisTimeHistogram from "@/features/survey/analysis-time-histogram"
import { loadSurveyPageData } from "@/features/survey/load-survey-page-data"
import { loadPageData } from "@/lib/load-page-data"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

export default async function SurveyResults({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const result = await loadPageData("loadSurveyPageData", () =>
    loadSurveyPageData(resolvedSearchParams?.dataPurpose),
  )
  if (!result.ok) return <DataLoadError />
  const data = result.data

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Surveys"
        title="analysisQuestionnaires コレクション"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CardPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            記録済み解析完了件数
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-950 dark:text-slate-100">
            {data.summary.totalAnalyses}
          </p>
        </CardPanel>
        <CardPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            全回答数
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-950 dark:text-slate-100">
            {data.summary.totalResponses}
          </p>
        </CardPanel>
        <CardPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            回答者数
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-950 dark:text-slate-100">
            {data.summary.uniqueParticipants}
          </p>
        </CardPanel>
      </div>

      <AnalysisTimeHistogram distribution={data.analysisTimeDistribution} />

      <CardPanel className="flex flex-col gap-4 p-5">
        <SectionHeading eyebrow="Analysis attempts" title="解析の実行状況" />
        <p>
          開始 {data.attemptCounts.total}件 ／ 完了{" "}
          {data.attemptCounts.completed}件 ／ 失敗 {data.attemptCounts.failed}件
          ／ 中断 {data.attemptCounts.cancelled}件 ／ 終了未確認{" "}
          {data.attemptCounts.unconfirmed}件
        </p>
        <p className="text-sm text-slate-500">
          終了未確認には実行中や通信切断を含みます。解析完了はアンケート完了とは別に集計しています。本文文字数は書類ごとの値です。
        </p>
        <p className="text-sm">
          実行記録：全{data.attemptCounts.total}件中、最新{data.attempts.length}
          件を表示しています。
        </p>
        {data.attempts.length === 0 ? (
          <p className="text-sm">該当する解析の実行記録はありません。</p>
        ) : (
          <section
            aria-label="解析の実行記録"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the wide table.
            tabIndex={0}
            className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand)"
          >
            <table className="w-full min-w-max text-left text-sm">
              <caption className="sr-only">解析の実行記録</caption>
              <thead>
                <tr>
                  {[
                    "開始日時",
                    "対象者",
                    "同意記録",
                    "アンケート区分",
                    "解析状態",
                    "本文文字数",
                    "所要時間",
                  ].map((label) => (
                    <th key={label} className="whitespace-nowrap px-3 py-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.attempts.map((record) => (
                  <tr key={record.id}>
                    <td className="px-3 py-2">
                      {formatDateTime(record.startedAt)}
                    </td>
                    <td className="px-3 py-2">{record.pseudonym}</td>
                    <td className="px-3 py-2">{record.consentId}</td>
                    <td className="px-3 py-2">
                      {record.questionnaireKind === "initial"
                        ? "初回用"
                        : record.questionnaireKind === "follow-up"
                          ? "フォローアップ"
                          : "不明"}
                    </td>
                    <td className="px-3 py-2">
                      {ANALYSIS_OUTCOME_LABELS[record.outcome]}
                    </td>
                    <td className="px-3 py-2">
                      {record.documentGraphemeCounts.join(" / ")}
                    </td>
                    <td className="px-3 py-2">
                      {record.durationMs === null
                        ? "-"
                        : `${(record.durationMs / 1000).toFixed(1)} sec`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </CardPanel>
      <CardPanel className="flex flex-col gap-4 p-5">
        <SectionHeading
          eyebrow="Latest Survey Updates"
          title="直近のアンケート更新"
        />
        <RecentActivityList items={data.recentActivity} />
      </CardPanel>

      <CardPanel className="overflow-hidden p-0">
        <div className="px-5 py-4">
          <SectionHeading title="アンケート記録" />
          <p className="mt-2 text-sm">
            全{data.summary.totalAnalyses}件中、最新{data.records.length}
            件を表示しています。上の集計は表示上限に関係なく全件が対象です。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max divide-y divide-slate-200 text-sm dark:divide-white/10">
            <thead className="bg-slate-50 dark:bg-slate-950/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  createdAt
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  アンケート区分
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  回答送信日時
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  pseudonym
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  BG1
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  BG2
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  modelName
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  解析時のバージョン
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">
                  serverId / 区分
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-white/10 dark:bg-slate-900/70">
              {data.records.map((record) => (
                <tr key={record.id}>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatDateTime(record.createdAt)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {record.surveyKind === "initial"
                      ? "初回用"
                      : record.surveyKind === "follow-up"
                        ? "フォローアップ"
                        : "未確定"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.submittedAt === null
                      ? "未送信"
                      : formatDateTime(record.submittedAt)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {record.pseudonym}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.answers.BG1 ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.answers.BG2 ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.modelName ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.analysisWorkspaceVersion ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {record.serverId} /{" "}
                    {DATA_PURPOSE_LABELS[record.dataPurpose]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardPanel>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        {data.itemSummaries.map((group) => (
          <CardPanel as="section" key={group.kind} className="grid gap-3 p-5">
            <SectionHeading title={group.title} />
            {group.items.map((item) => (
              <div
                key={`${item.definitionId}/${item.itemId}`}
                className="rounded-2xl border border-slate-200/80 px-4 py-3 dark:border-white/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    {item.itemId}
                  </p>
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  <span title={item.definitionId ?? undefined}>
                    （{item.definitionId?.slice(-12) ?? "版不明"}）
                  </span>
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  回答数: {item.responseCount}
                </p>
              </div>
            ))}
          </CardPanel>
        ))}
      </div>
    </CardSection>
  )
}
