import type { ActivityItem } from "./participant-record-types"
import { formatDateTime } from "./participant-records"

export default function RecentActivityList({
  items,
}: {
  items: ActivityItem[]
}) {
  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="min-w-0 rounded-2xl border border-slate-200/80 px-4 py-3 wrap-anywhere dark:border-white/10"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                {item.serverId}
              </p>
              <p className="mt-1 font-semibold text-slate-950 dark:text-slate-100">
                {item.title}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {item.detail}
              </p>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {formatDateTime(item.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
