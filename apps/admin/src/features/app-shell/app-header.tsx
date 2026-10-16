import AppHeaderActions from "@/features/app-shell/app-header-actions"
import {
  AppHeaderMenu,
  AppReloadButton,
} from "@/features/app-shell/app-header-controls"
import AppNavigation, {
  type AppPath,
} from "@/features/app-shell/app-navigation"

export default function AppHeader({
  currentPath,
  email,
  pageTitle,
  selectedServerId,
  receptionExpiresAt,
  backendStopsAt,
  dataPurpose = "research",
  adminAuthBypassEnabled,
}: {
  currentPath: AppPath
  email: string | null
  pageTitle: string
  selectedServerId: string
  receptionExpiresAt: Date
  backendStopsAt: Date
  dataPurpose?: string
  adminAuthBypassEnabled: boolean
}) {
  return (
    <header className="flex w-full min-w-0 flex-col gap-3 rounded-2xl border border-white/60 bg-linear-to-r from-(--brand-solid) to-emerald-800 p-4 text-white shadow-md shadow-[rgba(15,23,42,0.16)] sm:p-6 dark:border-white/10">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase">
            ADMIN-AERPP
          </p>
          <h1 className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">
            {pageTitle}
          </h1>
        </div>
        <AppReloadButton />
      </div>
      <AppHeaderMenu key={currentPath}>
        <AppNavigation currentPath={currentPath} dataPurpose={dataPurpose} />
        <details className="min-w-0 text-sm lg:max-w-sm">
          <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 font-semibold hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            アカウント・環境情報
          </summary>
          <div className="mt-3 flex min-w-0 flex-col gap-3 rounded-xl border border-white/20 p-3">
            <AppHeaderActions
              email={email}
              adminAuthBypassEnabled={adminAuthBypassEnabled}
            />
            <p className="wrap-anywhere">serverId: {selectedServerId}</p>
            {[
              { label: "Web受付終了日時", value: receptionExpiresAt },
              { label: "Support終了日時", value: backendStopsAt },
            ].map(({ label, value }) => (
              <p key={label}>
                {label}：
                <time dateTime={value.toISOString()}>
                  {new Intl.DateTimeFormat("ja-JP", {
                    timeZone: "Asia/Tokyo",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hourCycle: "h23",
                  }).format(value)}
                </time>{" "}
                （日本時間・UTC+09:00）
              </p>
            ))}
          </div>
        </details>
      </AppHeaderMenu>
    </header>
  )
}
