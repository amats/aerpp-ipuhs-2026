"use client"

import Link from "next/link"
import DataLoadError from "@/features/app-shell/data-load-error"
import MainContentLayout from "@/ui/main-content-layout"

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <MainContentLayout>
      <DataLoadError retry={retry} title="画面を表示できませんでした" />
      <Link href="/dashboard" className="min-h-11 py-3 underline">
        ダッシュボードに戻る
      </Link>
    </MainContentLayout>
  )
}
