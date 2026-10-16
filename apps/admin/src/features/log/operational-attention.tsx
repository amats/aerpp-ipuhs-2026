import { operationalAttentionComment } from "./operational-attention-comment"
import { operationalConsoleUrl } from "./operational-console-url"
import { operationalLogQuery } from "./operational-log-query"
import { SERVICE_LABELS } from "./operational-log-summary"
import type { OperationalGroup } from "./operational-log-types"
import OperationalQuery from "./operational-query"

export function formatOperationalTime(value: string | null): string {
  return value === null
    ? "日時不明"
    : `${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}（日本時間）`
}

export default function OperationalAttention({
  groups,
  error,
  truncated,
  since,
  until,
  limit = 20,
}: {
  groups: OperationalGroup[]
  error: string | null
  truncated: boolean
  since: string
  until: string
  limit?: number
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        警告・失敗の記録を確認候補としてまとめます。テストや想定内の拒否も含まれ、すべてが対応を要する障害とは限りません。対応済みかどうかも記録から断定しません。
      </p>
      {error !== null ? (
        <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
          {error}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {truncated === true
              ? "取得分のみの集計です。期間全体の件数ではありません。"
              : "指定期間に取得したログの集計です。"}{" "}
            件数はログの数で、利用回数ではありません。
          </p>
          {groups.length === 0 ? (
            <p>
              取得したログに確認対象の事象はありません。稼働状態を保証するものではありません。
            </p>
          ) : (
            <>
              <p className="text-sm">
                表示 {Math.min(groups.length, limit)} / {groups.length}種類
              </p>
              {groups.slice(0, limit).map((group) => {
                const url = operationalConsoleUrl(since, until, group)
                const query = operationalLogQuery(since, until, group)
                return (
                  <div
                    key={group.key}
                    className="min-w-0 rounded-xl border border-amber-200 p-4 dark:border-amber-800"
                  >
                    <p className="font-semibold">
                      {SERVICE_LABELS[group.service]}：{group.title}
                    </p>
                    <p className="mt-1 text-sm">
                      {group.result} · {group.count}件
                      {group.statusCode !== null &&
                        ` · HTTP ${group.statusCode}`}
                    </p>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {operationalAttentionComment(group)}
                    </p>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      初回：{formatOperationalTime(group.firstAt)}
                      <br />
                      最終：{formatOperationalTime(group.lastAt)}
                    </p>
                    {url !== null && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-(--brand)"
                      >
                        この事象のログを調査（新しいタブ）
                      </a>
                    )}
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer font-medium">
                        ログの検索条件を表示
                      </summary>
                      <p className="mt-2 text-slate-600 dark:text-slate-300">
                        リンク先で条件が反映されない場合は、Google Cloud のログ
                        エクスプローラにこの条件を貼り付けて検索してください。
                      </p>
                      <OperationalQuery key={query} query={query} />
                    </details>
                  </div>
                )
              })}
            </>
          )}
        </>
      )}
    </div>
  )
}
