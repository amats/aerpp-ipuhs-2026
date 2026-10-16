import Link from "next/link"
import DataLoadError from "@/features/app-shell/data-load-error"
import { formatDateTime } from "@/features/monitoring/participant-records"
import { loadActivityPageData } from "@/features/updates/load-activity-page-data"
import { loadPageData } from "@/lib/load-page-data"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

export default async function ParticipantActivity({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const result = await loadPageData("loadActivityPageData", () =>
    loadActivityPageData(resolvedSearchParams?.dataPurpose),
  )
  if (!result.ok) return <DataLoadError />
  const data = result.data

  return (
    <CardSection>
      <SectionHeading eyebrow="Latest" title="参加・回答履歴" />
      <CardPanel className="flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <SectionHeading
            eyebrow="Activity Feed"
            title="参加・回答の直近の履歴"
            className="min-w-0"
          />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {data.recentActivity.length}件
          </p>
        </div>

        <div className="space-y-3">
          {data.recentActivity.map((item) => (
            <div
              key={item.id}
              className="min-w-0 rounded-2xl border border-slate-200/80 px-4 py-3 wrap-anywhere dark:border-white/10"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                      {item.category}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {item.serverId}
                    </p>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {item.detail}
                  </p>
                  <Link
                    href={
                      item.category === "consent"
                        ? `/participant?dataPurpose=${data.filters.dataPurpose}`
                        : `/survey?dataPurpose=${data.filters.dataPurpose}`
                    }
                    className="mt-2 inline-flex text-sm font-semibold text-(--brand)"
                  >
                    {item.category === "consent"
                      ? "参加者ページで確認"
                      : "アンケートページで確認"}
                  </Link>
                </div>
                <p className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                  {formatDateTime(item.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardPanel>
    </CardSection>
  )
}
