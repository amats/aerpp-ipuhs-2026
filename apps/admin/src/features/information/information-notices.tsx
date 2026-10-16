import type { InformationRecord } from "@aerpp/firestore/information-types"
import Link from "next/link"
import CardPanel from "@/ui/card-panel"
import SectionHeading from "@/ui/section-heading"

export default function InformationNotices({
  records,
  error,
}: {
  records: InformationRecord[]
  error: string | null
}) {
  return (
    <CardPanel className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeading eyebrow="Information" title="お知らせ" />
        <Link
          href="/information"
          className="text-sm font-semibold text-(--brand)"
        >
          お知らせ管理
        </Link>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        この環境の全サーバー共通のお知らせです。
      </p>
      {error ? (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">
          {error}
        </p>
      ) : records.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          お知らせはありません。
        </p>
      ) : (
        records.map((record) => (
          <div
            key={record.id}
            className={`rounded-xl border p-4 ${
              record.tone === "error"
                ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
                : record.tone === "warning"
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                  : "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100"
            }`}
          >
            <p className="text-sm font-semibold">
              {record.tone === "error"
                ? "エラー"
                : record.tone === "warning"
                  ? "注意"
                  : "情報"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm wrap-anywhere">
              {record.content}
            </p>
          </div>
        ))
      )}
    </CardPanel>
  )
}
