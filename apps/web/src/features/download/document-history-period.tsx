import type { DocumentSetReference } from "@aerpp/config/document-set"
import Link from "next/link"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { requestHistoricalDocument } from "@/features/pdf/document-client"
import type {
  DocumentHistoryRecord,
  DocumentHistoryPeriod as Period,
} from "@/features/pdf/document-history-types"
import DocumentDownloadRow from "./document-download-row"

export function formatDocumentDate(date: string) {
  return new Date(date).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function VersionNotice({
  record,
  currentSet,
}: {
  record: DocumentHistoryRecord
  currentSet: DocumentSetReference
}) {
  const time = record.eventType === "consent" ? "同意時" : "撤回時"
  const same = record.documentSet.sha256 === currentSet.sha256
  return (
    <div className="mt-2 grid gap-1 text-sm text-slate-600 dark:text-slate-300">
      <p>
        {time}の書類の版：v{record.documentSet.version}
      </p>
      <p>
        {same === true
          ? `${time}と現在公開中の書類の版は同じです。`
          : record.documentSet.version === currentSet.version
            ? "版番号は同じですが、文書セットは異なります。"
            : `${time}と現在公開中の書類の版は異なります。現在公開中：v${currentSet.version}`}
        {same !== true && (
          <>
            {" "}
            <Link href="#current-documents" className="underline">
              現在公開中の書類を見る
            </Link>
          </>
        )}
      </p>
    </div>
  )
}

function RecordedDocuments({ record }: { record: DocumentHistoryRecord }) {
  const time = record.eventType === "consent" ? "同意時" : "撤回時"
  return (
    <>
      <DocumentDownloadRow
        label={`${time}の説明文書`}
        loadPdf={(token) =>
          requestHistoricalDocument(record.id, "explanation", token)
        }
      />
      <DocumentDownloadRow
        label={`${time}の研究計画書`}
        loadPdf={(token) => requestHistoricalDocument(record.id, "plan", token)}
      />
    </>
  )
}

export default function DocumentHistoryPeriod({
  period,
  currentSet,
  current = false,
}: {
  period: Period
  currentSet: DocumentSetReference
  current?: boolean
}) {
  const { withdrawalCleanupStatus } = useAppContext()
  const withdrawal = period.withdrawal
  return (
    <div className="mt-4 grid min-w-0 gap-4">
      <section aria-label="同意の記録">
        <h3 className="font-semibold">
          同意成立：
          <time dateTime={period.consent.date}>
            {formatDocumentDate(period.consent.date)}（日本時間）
          </time>
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          同意成立日時は、メール認証が完了した日時です。同意書の記載日もこの日付です。
        </p>
        <VersionNotice record={period.consent} currentSet={currentSet} />
        <ul className="mt-3">
          <DocumentDownloadRow
            label="同意書の控え"
            primary={current}
            loadPdf={(token) =>
              requestHistoricalDocument(period.consent.id, "consent", token)
            }
          />
          <RecordedDocuments record={period.consent} />
        </ul>
      </section>
      {withdrawal && (
        <section
          aria-label="撤回の記録"
          className="border-t border-slate-200/80 pt-4 dark:border-white/10"
        >
          <h3 className="font-semibold">
            撤回受付：
            <time dateTime={withdrawal.date}>
              {formatDocumentDate(withdrawal.date)}（日本時間）
            </time>
          </h3>
          <VersionNotice record={withdrawal} currentSet={currentSet} />
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            同意撤回書は撤回受付の控えです。データの消去完了を証明するものではありません。
          </p>
          <ul className="mt-3">
            <DocumentDownloadRow
              label="同意撤回書の控え"
              primary={current}
              loadPdf={(token) =>
                requestHistoricalDocument(withdrawal.id, "withdrawal", token)
              }
            />
          </ul>
          <details className="mt-1">
            <summary className="cursor-pointer rounded py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-(--brand-blue)">
              撤回時の関連書類
            </summary>
            <ul>
              <RecordedDocuments record={withdrawal} />
            </ul>
          </details>
          {current === true && withdrawalCleanupStatus !== "complete" && (
            <Link
              href="/withdraw"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline"
            >
              撤回・消去の状況を確認する
            </Link>
          )}
        </section>
      )}
    </div>
  )
}
