import CardPanel from "@/ui/card-panel"
import SectionHeading from "@/ui/section-heading"
import type {
  AnalysisTimeBin,
  AnalysisTimeDistribution,
} from "./analysis-time-distribution-types"

const SECONDS_FORMAT = new Intl.NumberFormat("ja-JP", {
  maximumSignificantDigits: 6,
})

function intervalLabel(bin: AnalysisTimeBin, isLast: boolean): string {
  if (bin.lowerSec === bin.upperSec)
    return `${SECONDS_FORMAT.format(bin.lowerSec)}秒`
  let lower = SECONDS_FORMAT.format(bin.lowerSec)
  let upper = SECONDS_FORMAT.format(bin.upperSec)
  if (lower === upper) {
    lower = String(bin.lowerSec)
    upper = String(bin.upperSec)
  }
  return `${lower}秒以上 ${upper}秒${isLast ? "以下" : "未満"}`
}

export default function AnalysisTimeHistogram({
  distribution,
}: {
  distribution: AnalysisTimeDistribution
}) {
  const { bins, validCount, unknownCount, method } = distribution
  const peak = bins.reduce((maximum, bin) => Math.max(maximum, bin.count), 0)
  const tickStep = Math.max(1, Math.ceil(peak / 4))
  const yMax = tickStep * 4
  const min = bins[0]?.lowerSec ?? 0
  const max = bins.at(-1)?.upperSec ?? 0
  const xTicks = min === max ? [0.5] : [0, 0.5, 1]

  return (
    <CardPanel
      as="section"
      aria-labelledby="analysis-time-heading"
      className="flex flex-col gap-4 p-5"
    >
      <SectionHeading titleId="analysis-time-heading" title="解析時間の分布" />
      <p className="text-sm text-slate-600 dark:text-slate-300">
        選択中の条件に該当する解析完了記録の全件が対象です。アンケート未回答も含みます。
        解析時間は準備処理を含む出力完了までの時間です。
      </p>
      <p className="text-sm">
        集計対象: {validCount}件 ／ 時間不明: {unknownCount}件
      </p>
      {bins.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          表示できる解析時間がありません。
        </p>
      ) : (
        <>
          <figure>
            <div
              role="img"
              aria-label="解析時間のヒストグラム"
              aria-describedby="analysis-time-chart-description"
              className="text-slate-600 dark:text-slate-300"
            >
              <p id="analysis-time-chart-description" className="sr-only">
                横軸は解析時間（秒）、縦軸は件数。区間ごとの件数は下の表で確認できます。
              </p>
              <p className="mb-3 ml-10 text-xs">件数</p>
              <div className="relative ml-10 mr-2 h-48 border-b border-l border-slate-400 dark:border-slate-500">
                {[0, 1, 2, 3, 4].map((index) => {
                  return (
                    <div
                      key={index}
                      className="pointer-events-none absolute w-full border-t border-slate-200 dark:border-slate-700"
                      style={{ top: `${100 * (1 - index / 4)}%` }}
                    >
                      <span className="absolute right-full -translate-y-1/2 pr-2 text-xs tabular-nums">
                        {index * tickStep}
                      </span>
                    </div>
                  )
                })}
                <div className="relative flex h-full items-end">
                  {bins.map((bin, index) => (
                    <div
                      key={`${bin.lowerSec}:${bin.upperSec}`}
                      title={`${intervalLabel(bin, index === bins.length - 1)}: ${bin.count}件`}
                      className="min-w-0 flex-1 border-r-[0.5px] border-(--background) bg-(--brand)"
                      style={{ height: `${100 * (bin.count / yMax)}%` }}
                    />
                  ))}
                </div>
              </div>
              <div
                className={`mt-2 ml-10 mr-2 flex gap-2 text-xs tabular-nums ${min === max ? "justify-center" : "justify-between"}`}
              >
                {xTicks.map((fraction) => (
                  <span key={fraction} className="min-w-0 break-all">
                    {SECONDS_FORMAT.format(min + (max - min) * fraction)}
                  </span>
                ))}
              </div>
              <p className="mt-2 ml-10 text-center text-xs">解析時間（秒）</p>
            </div>
            <figcaption className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {method === "single"
                ? "すべて同じ解析時間のため、1区間で表示しています。"
                : `区間は${method === "freedman-diaconis" ? "Freedman–Diaconis法" : "Sturges法"}で自動設定しています（${bins.length}区間）。`}
            </figcaption>
          </figure>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-(--brand)">
              区間ごとの件数
            </summary>
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">解析時間の区間別件数</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      解析時間（秒）
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      件数
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bins.map((bin, index) => (
                    <tr key={`${bin.lowerSec}:${bin.upperSec}`}>
                      <td className="px-3 py-2">
                        {intervalLabel(bin, index === bins.length - 1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {bin.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </CardPanel>
  )
}
