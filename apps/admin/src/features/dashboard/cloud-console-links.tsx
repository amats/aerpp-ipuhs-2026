import { env } from "@aerpp/config/server/admin"
import CardPanel from "@/ui/card-panel"
import SectionHeading from "@/ui/section-heading"

const CONSOLE_LINKS = [
  {
    path: "/home/dashboard",
    label: "プロジェクト概要",
    description: "GCP ダッシュボード",
  },
  {
    path: "/logs/query",
    label: "ログ エクスプローラ",
    description: "ログの検索・調査",
  },
  {
    path: "/errors",
    label: "Error Reporting",
    description: "エラーの集計・レポート",
  },
  {
    path: "/monitoring/dashboards",
    label: "監視ダッシュボード",
    description: "メトリクス・稼働状況",
  },
  {
    path: "/monitoring/alerting",
    label: "アラート",
    description: "インシデント・通知ポリシー",
  },
  { path: "/run", label: "Cloud Run", description: "サービス・リビジョン" },
  {
    path: "/firestore/databases",
    label: "Firestore",
    description: "データベース・使用状況",
  },
  {
    path: "/cloudscheduler",
    label: "Cloud Scheduler",
    description: "定期実行ジョブの状態",
  },
  {
    path: "/billing/linkedaccount",
    label: "請求・費用",
    description: "請求先の確認・費用レポートへの入口",
  },
] as const

export default function CloudConsoleLinks() {
  const projectId = env.gcpProjectId
  const available =
    Boolean(projectId) && ["test", "production"].includes(env.environment)

  return (
    <CardPanel className="flex flex-col gap-4 p-5">
      <SectionHeading eyebrow="Google Cloud" title="GCP コンソール" />
      {available ? (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            現在の環境のプロジェクトを新しいタブで開きます。Google Cloud
            の閲覧権限が必要です。
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CONSOLE_LINKS.map(({ path, label, description }) => {
              const url = new URL(path, "https://console.cloud.google.com")
              url.searchParams.set("project", projectId ?? "")
              return (
                <a
                  key={path}
                  href={url.toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 rounded-xl border border-slate-200/80 p-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:bg-slate-900/60"
                >
                  <span className="font-semibold text-(--brand)">
                    {label} <span aria-hidden="true">↗</span>
                  </span>
                  <span className="sr-only">（新しいタブで開く）</span>
                  <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
                    {description}
                  </span>
                </a>
              )
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          クラウド環境のプロジェクトが設定されている場合に利用できます。
        </p>
      )}
    </CardPanel>
  )
}
