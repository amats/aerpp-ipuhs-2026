"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

export default function DataLoadError({
  retry,
  title = "データを取得できませんでした",
}: {
  retry?: () => void
  title?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <CardSection>
      <SectionHeading title={title} />
      <p role="alert">
        表示内容を確認できません。時間をおいて再試行してください。繰り返し失敗する場合は、接続やアクセス権限を確認してください。
      </p>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(() => (retry ?? router.refresh)())}
        className="min-h-11 w-fit rounded-lg bg-(--brand-solid) px-4 py-2 font-semibold text-(--brand-on-solid) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand) disabled:opacity-60"
      >
        {pending ? "再読み込み中…" : "再試行"}
      </button>
    </CardSection>
  )
}
