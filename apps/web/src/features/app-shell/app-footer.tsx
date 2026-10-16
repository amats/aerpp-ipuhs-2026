"use client"

import Link from "next/link"
import AdminRecoveryControl from "@/features/home-flow/admin-recovery-control"
import { SOFT_BADGE_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

export default function AppFooter({
  appVersion,
  showDevelopmentLinks = false,
}: {
  appVersion: string
  showDevelopmentLinks?: boolean
}) {
  const showWithdrawal = true
  const linkClassName =
    "inline-flex min-h-11 w-fit items-center rounded-lg px-2 py-2 text-sm font-semibold text-(--brand-text) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue)"

  return (
    <footer className="flex w-full flex-col gap-4 rounded-2xl border border-white/60 bg-white/80 px-5 py-4 text-xs text-slate-600 shadow-md shadow-slate-200/60 backdrop-blur-md sm:px-6 sm:py-5 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-200 dark:shadow-black/30">
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 leading-relaxed">
          <Link href="/" className={linkClassName}>
            解析ステップ
          </Link>
          <Link href="/license" className={linkClassName}>
            ライセンス情報
          </Link>
          <Link href="/download" className={linkClassName}>
            同意履歴・関連書類
          </Link>
          {showWithdrawal && (
            <Link href="/withdraw" className={linkClassName}>
              同意の撤回
            </Link>
          )}
          {showDevelopmentLinks && (
            <Link href="/debug" className={linkClassName}>
              Debug
            </Link>
          )}
          {showDevelopmentLinks && (
            <Link href="/debug/home-flow" className={linkClassName}>
              Home Flow Debug
            </Link>
          )}
          {showDevelopmentLinks && (
            <Link href="/debug/alert-message" className={linkClassName}>
              Alert Message Debug
            </Link>
          )}
          {showDevelopmentLinks && (
            <Link href="/reset" className={linkClassName}>
              Reset
            </Link>
          )}
        </div>
        <span
          className={uiClassName(
            SOFT_BADGE_CLASS_NAME,
            "w-fit shrink-0 px-3 py-1 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-200",
          )}
        >
          Version {appVersion}
        </span>
      </div>
      <AdminRecoveryControl />
    </footer>
  )
}
