import type { DataPurposeFilter } from "@aerpp/firestore/data-purpose-types"
import Link from "next/link"
import type { OperationalUsage } from "./operational-log-types"
import { USAGE_KEYS, USAGE_LABELS } from "./operational-usage"

export default function OperationalUsagePanel({
  usage,
  dataPurpose,
}: {
  usage: OperationalUsage | null
  dataPurpose: DataPurposeFilter
}) {
  if (usage === null)
    return (
      <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
        利用状況を取得できませんでした。リロードして再試行してください。
      </p>
    )
  const maximum = Math.max(1, ...usage.daily.map((row) => row.counts.starts))
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        現在保持されている記録に基づく運用参考値です。撤回により削除された解析・回答は含みません。累積実績や研究の最終集計には使用しないでください。
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {USAGE_KEYS.map((key) => (
          <div
            key={key}
            className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950/40"
          >
            <p className="text-sm">{USAGE_LABELS[key]}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {usage.counts[key]}
              <span className="ml-1 text-sm font-normal">件</span>
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm">
        解析終了の内訳は、期間内に開始した試行の現在の記録です。「終了未確認」には実行中も含みます。解析完了は結果の閲覧やアンケート提出を示しません。
      </p>
      <details open>
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">
          日別の利用状況（日本時間）
        </summary>
        <section
          aria-label="日別の利用状況"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Allow keyboard users to scroll the table region.
          tabIndex={0}
          className="max-h-112 overflow-auto rounded-xl border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10"
        >
          <table className="w-full text-sm">
            <caption className="p-3 text-left">
              解析終了の内訳は開始日別です。初日・最終日は選択期間内の時間のみを集計します。
            </caption>
            <thead>
              <tr>
                <th scope="col" className="whitespace-nowrap p-3 text-left">
                  日付
                </th>
                {USAGE_KEYS.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="whitespace-nowrap p-3 text-right"
                  >
                    {USAGE_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.daily.map((row) => (
                <tr
                  key={row.date}
                  className="border-t border-slate-200 dark:border-white/10"
                >
                  <th
                    scope="row"
                    className="whitespace-nowrap p-3 text-left font-normal"
                  >
                    {row.date}
                  </th>
                  {USAGE_KEYS.map((key) => (
                    <td
                      key={key}
                      className="relative min-w-24 p-3 text-right tabular-nums"
                    >
                      {key === "starts" && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1 left-0 rounded bg-emerald-100 dark:bg-emerald-900/40"
                          style={{
                            width: `${(row.counts.starts / maximum) * 100}%`,
                          }}
                        />
                      )}
                      <span className="relative">{row.counts[key]}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </details>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        日時不明で期間集計から除外した記録：{usage.unknownDates}
        件（現在のサーバー・データ区分の保持記録）
      </p>
      <div className="flex flex-wrap gap-4 text-sm font-semibold text-(--brand)">
        <Link href={`/survey?dataPurpose=${dataPurpose}`}>
          解析試行・回答・解析時間の分布を確認
        </Link>
        <Link href={`/updates?dataPurpose=${dataPurpose}`}>
          参加・回答履歴を確認
        </Link>
        <Link href={`/participant?dataPurpose=${dataPurpose}`}>
          参加者の確認・復旧判断
        </Link>
      </div>
    </div>
  )
}
