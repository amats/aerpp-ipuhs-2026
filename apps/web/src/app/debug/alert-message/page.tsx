import { env } from "@aerpp/config/server/web"
import { notFound } from "next/navigation"
import DebugAlertMessagePreview from "@/features/debug/debug-alert-message-preview"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

export default async function AlertMessagePreviewPage() {
  if (env.debugPagesEnabled !== true) notFound()
  return (
    <CardSection className="gap-5">
      <SectionHeading
        eyebrow="Preview"
        title="AlertMessage / 入力エラー"
        description="通常・compact の通知と、メール登録・文書アップロード・アンケートで使うシンプルな入力エラーの表示を確認できます。"
      />
      <div className="min-w-0">
        <div className="mb-4 flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            通知と入力エラーのプレビュー
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Standard と Compact
            は閉じる・再表示の操作ができます。入力エラーは各入力欄の近くに表示します。
          </p>
        </div>
        <DebugAlertMessagePreview />
      </div>
    </CardSection>
  )
}
