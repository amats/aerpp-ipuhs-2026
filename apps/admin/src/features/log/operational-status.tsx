import { DATA_PURPOSE_LABELS } from "@aerpp/firestore/data-purpose-types"
import { requireAdminSession } from "@/lib/auth"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import { loadOperationalPageData } from "./load-operational-page-data"
import OperationalAttention, {
  formatOperationalTime,
} from "./operational-attention"
import { operationalConsoleUrl } from "./operational-console-url"
import { maintenanceResult, SERVICE_LABELS } from "./operational-log-summary"
import OperationalUsagePanel from "./operational-usage-panel"

export default async function OperationalStatus({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminSession("/log")
  const params = searchParams ? await searchParams : undefined
  const data = await loadOperationalPageData({
    period: params?.period,
    dataPurpose: params?.dataPurpose,
  })
  const consoleUrl = operationalConsoleUrl(data.logs.since, data.logs.until)
  return (
    <CardSection>
      <SectionHeading
        eyebrow="Operations"
        title="利用とメンテナンスの状況"
        description="利用の動き、確認が必要な事象、定期処理の結果を確認できます。"
      />
      <CardPanel className="space-y-3 p-5">
        <form className="flex flex-wrap items-end gap-3">
          <input
            type="hidden"
            name="dataPurpose"
            value={data.filters.dataPurpose}
          />
          <div className="flex flex-col gap-2 text-sm font-medium">
            <label htmlFor="operational-period">期間</label>
            <select
              id="operational-period"
              name="period"
              defaultValue={String(data.filters.periodDays)}
              className="min-h-11 rounded-lg border bg-white px-3 py-2 text-slate-900"
            >
              <option value="1">直近1日</option>
              <option value="7">直近7日</option>
              <option value="30">直近30日</option>
            </select>
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-full bg-(--brand-solid) px-5 py-2.5 font-semibold text-(--brand-on-solid)"
          >
            更新
          </button>
        </form>
        <p className="text-sm">
          対象期間：{formatOperationalTime(data.logs.since)} ～{" "}
          {formatOperationalTime(data.logs.until)}
        </p>
        <p className="text-sm">
          取得開始：{formatOperationalTime(data.loadedAt)} · 利用状況：serverId{" "}
          {data.filters.serverId} /{" "}
          {DATA_PURPOSE_LABELS[data.filters.dataPurpose]}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          運用ログ・メンテナンスは現在の環境全体が対象です。データ区分による絞り込みは利用状況にのみ適用します。
        </p>
        <nav
          aria-label="運用状況の表示エリア"
          className="flex flex-wrap gap-4 text-sm font-semibold text-(--brand)"
        >
          <a href="#attention">要対応事項</a>
          <a href="#usage">利用状況</a>
          <a href="#maintenance">定期メンテナンス</a>
          <a href="#events">運用イベント</a>
        </nav>
      </CardPanel>
      <CardPanel as="section" id="attention" className="space-y-4 p-5">
        <SectionHeading title="要対応事項" />
        <OperationalAttention
          groups={data.summary.attention}
          error={data.logs.error}
          truncated={data.logs.truncated}
          since={data.logs.since}
          until={data.logs.until}
        />
      </CardPanel>
      <CardPanel as="section" id="usage" className="space-y-4 p-5">
        <SectionHeading title="利用状況" />
        <OperationalUsagePanel
          usage={data.usage.ok === true ? data.usage.data : null}
          dataPurpose={data.filters.dataPurpose}
        />
      </CardPanel>
      <CardPanel as="section" id="maintenance" className="space-y-4 p-5">
        <SectionHeading
          title="定期メンテナンス"
          description="指定期間内で最後に確認できた定期処理の結果です。現在の稼働やメールの到達を保証するものではありません。"
        />
        {data.logs.maintenanceError !== null ? (
          <p
            role="status"
            className="text-sm text-amber-800 dark:text-amber-200"
          >
            {data.logs.maintenanceError}
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            {
              operation: "withdrawalCleanup",
              title: "撤回データ削除",
              interval: "30分ごとの定期実行",
            },
            {
              operation: "mailHealth",
              title: "メール基盤点検",
              interval: "6時間ごとの定期実行・メール送信なし",
            },
          ].map((job) => {
            const entry = data.logs.maintenanceEntries.find(
              (item) => item.operation === job.operation,
            )
            return (
              <div
                key={job.operation}
                className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-white/10"
              >
                <h3 className="font-semibold">{job.title}</h3>
                <p>{maintenanceResult(entry)}</p>
                <p className="text-sm">
                  {formatOperationalTime(entry?.timestamp ?? null)}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {job.interval}
                </p>
                {entry?.operation === "withdrawalCleanup" &&
                  entry.code === "MAINTENANCE_COMPLETED" && (
                    <p className="text-sm">
                      この実行の処理件数：確認 {entry.counts.scanned ?? "不明"}{" "}
                      / 完了 {entry.counts.completed ?? "不明"} / 持越し{" "}
                      {entry.counts.pending ?? "不明"} / 失敗{" "}
                      {entry.counts.failed ?? "不明"}
                      （環境全体の未処理件数ではありません）
                    </p>
                  )}
              </div>
            )
          })}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          処理対象は受付期間の前後12時間を含む期間です。期間外のスキップは処理完了ではありません。記録がない場合は正常・停止を判定しません。
        </p>
      </CardPanel>
      <CardPanel as="section" id="events" className="space-y-4 p-5">
        <SectionHeading title="主な運用イベント" />
        {data.logs.error !== null ? (
          <p role="status">{data.logs.error}</p>
        ) : (
          <>
            <p className="text-sm">
              取得 {data.summary.events.length}件 / 表示{" "}
              {Math.min(100, data.summary.events.length)}件 · 再試行ログ{" "}
              {data.summary.retryCount}件
              {data.logs.truncated === true ? "（取得分のみ）" : ""}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              拒否・中断・再試行は区別して表示します。再試行の最終結果は関連ログで確認してください。
            </p>
            {data.summary.events.length === 0 ? (
              <p>指定期間に運用イベントを確認できません。</p>
            ) : (
              <section
                aria-label="運用イベント一覧"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Allow keyboard users to scroll the table region.
                tabIndex={0}
                className="max-h-112 overflow-auto rounded-xl border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10"
              >
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {["日時（日本時間）", "サービス", "事象", "結果"].map(
                        (title) => (
                          <th
                            key={title}
                            scope="col"
                            className="whitespace-nowrap p-3"
                          >
                            {title}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.events.slice(0, 100).map((item) => (
                      <tr
                        key={item.entry.id}
                        className="border-t border-slate-200 dark:border-white/10"
                      >
                        <td className="whitespace-nowrap p-3">
                          {formatOperationalTime(item.entry.timestamp)}
                        </td>
                        <td className="p-3">
                          {SERVICE_LABELS[item.entry.service]}
                        </td>
                        <td className="min-w-48 p-3">{item.title}</td>
                        <td className="min-w-32 p-3">
                          {item.result}
                          {item.entry.statusCode !== null &&
                            ` · HTTP ${item.entry.statusCode}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
        {consoleUrl !== null && (
          <a
            href={consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center font-semibold text-(--brand)"
          >
            指定期間のログを調査（新しいタブ）
          </a>
        )}
      </CardPanel>
    </CardSection>
  )
}
