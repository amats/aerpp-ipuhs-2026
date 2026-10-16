import Link from "next/link"
import { uiClassName } from "@/ui/ui-styles"

export const APP_PAGES = [
  { href: "/dashboard", label: "ダッシュボード", title: "管理ダッシュボード" },
  { href: "/information", label: "お知らせ", title: "お知らせ管理" },
  { href: "/participant", label: "参加者", title: "参加者" },
  { href: "/survey", label: "アンケート結果", title: "アンケート結果" },
  {
    href: "/research",
    label: "データ出力",
    title: "研究・参加管理データの出力",
  },
  { href: "/log", label: "運用状況", title: "運用状況" },
  { href: "/updates", label: "参加・回答履歴", title: "参加・回答履歴" },
] as const

export type AppPath = (typeof APP_PAGES)[number]["href"]

export default function AppNavigation({
  currentPath,
  dataPurpose = "research",
  variant = "header",
}: {
  currentPath: AppPath
  dataPurpose?: string
  variant?: "header" | "footer"
}) {
  return (
    <nav
      className="flex min-w-0 flex-wrap gap-2"
      aria-label={
        variant === "header" ? "メインナビゲーション" : "フッターナビゲーション"
      }
    >
      {APP_PAGES.map((page) => (
        <Link
          key={page.href}
          href={`${page.href}${dataPurpose === "research" ? "" : `?dataPurpose=${encodeURIComponent(dataPurpose)}`}`}
          aria-current={page.href === currentPath ? "page" : undefined}
          className={uiClassName(
            "inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
            variant === "header"
              ? "border text-white focus-visible:outline-white"
              : "text-(--brand) underline-offset-4 hover:underline focus-visible:outline-(--brand)",
            variant === "header" &&
              (page.href === currentPath
                ? "border-white/50 bg-white/20"
                : "border-white/20 hover:bg-white/15"),
            variant === "footer" && page.href === currentPath && "underline",
          )}
        >
          {page.label}
        </Link>
      ))}
    </nav>
  )
}
