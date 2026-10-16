import type { Metadata } from "next"
import AppShell from "@/features/app-shell/app-shell"
import ResearchDownloads from "@/features/research/research-downloads"
import { requireAdminSession } from "@/lib/auth"

export const metadata: Metadata = {
  title: "研究・参加管理データの出力",
  description:
    "AERPPに保存されている研究用データと参加管理・アクセスデータを、全期間・全サーバーについて分けて出力できます。",
}

export default async function ResearchPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminSession("/research")
  return (
    <AppShell currentPath="/research" searchParams={searchParams}>
      <ResearchDownloads />
    </AppShell>
  )
}
