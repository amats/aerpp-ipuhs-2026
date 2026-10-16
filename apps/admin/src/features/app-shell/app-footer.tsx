import Link from "next/link"
import AppNavigation, {
  type AppPath,
} from "@/features/app-shell/app-navigation"
import { SOFT_BADGE_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

export default function AppFooter({
  appVersion,
  currentPath,
  dataPurpose = "research",
}: {
  appVersion: string
  currentPath: AppPath
  dataPurpose?: string
}) {
  return (
    <footer className="flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-white/60 bg-white/80 px-5 py-4 text-xs text-slate-600 shadow-md shadow-slate-200/60 backdrop-blur-md sm:px-6 sm:py-5 md:flex-row md:items-center md:justify-between dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-200 dark:shadow-black/30">
      <AppNavigation
        currentPath={currentPath}
        dataPurpose={dataPurpose}
        variant="footer"
      />
      <Link href="/license" className="underline">
        ライセンス情報
      </Link>
      <span
        className={uiClassName(
          SOFT_BADGE_CLASS_NAME,
          "w-fit shrink-0 px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-200",
        )}
      >
        Version {appVersion}
      </span>
    </footer>
  )
}
