"use client"

import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import {
  requestExplanationPdf,
  requestPlanPdf,
} from "@/features/pdf/document-client"
import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import CardPanel from "@/ui/card-panel"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import DocumentDownloadRow from "./document-download-row"
import DocumentHistory from "./document-history"

export default function DownloadPage({
  contactEmail,
}: {
  contactEmail: string
}) {
  const { stage, sessionAdmission } = useAppContext()
  const currentSet = readDisplayedDocumentSet()
  const canReadHistory =
    stage === Stage.authenticated ||
    stage === Stage.withdrawn ||
    stage === Stage.followUp
  const ready = sessionAdmission === "ready"

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Consent & Documents"
        title="同意履歴・関連書類"
        description="同意・撤回の記録と、それぞれの時点の書類を確認できます。"
      />
      {canReadHistory === true && (
        <DocumentHistory key={stage} currentSet={currentSet} />
      )}
      <CardPanel
        as="section"
        aria-labelledby="current-documents"
        className="min-w-0 p-4 sm:p-5"
      >
        <h2 id="current-documents" className="text-lg font-semibold">
          現在公開中の書類
        </h2>
        <p className="mt-2 text-sm">書類の版：v{currentSet.version}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          説明文書・同意書などをまとめた文書セットの版です。
          {canReadHistory === true &&
            "同意時の書類は、上の同意履歴から取得できます。"}
        </p>
        <ul className="mt-3">
          <DocumentDownloadRow
            label="説明文書"
            loadPdf={requestExplanationPdf}
          />
          <DocumentDownloadRow
            key={`${stage}-${sessionAdmission}`}
            label="研究計画書"
            loadPdf={requestPlanPdf}
            disabled={canReadHistory !== true || ready !== true}
            hint={
              canReadHistory !== true
                ? "同意とメール認証の完了後に取得できます。"
                : sessionAdmission === "unavailable"
                  ? "利用状態を確認できません。上の同意履歴の案内に従ってください。"
                  : ready !== true
                    ? "利用状態を確認しています。"
                    : undefined
            }
          />
        </ul>
      </CardPanel>
      {canReadHistory !== true && (
        <section
          aria-labelledby="history-access"
          className="grid gap-2 text-sm text-slate-600 dark:text-slate-300"
        >
          <h2
            id="history-access"
            className="font-semibold text-slate-900 dark:text-slate-100"
          >
            同意履歴の確認について
          </h2>
          <p>
            {stage === Stage.confirmationSent
              ? "メール認証待ちです。認証メールのリンクを開いて確認が完了すると、今回の同意履歴と同意書の控えを確認できます。"
              : "このブラウザーでは同意履歴を確認できません。同意書などの控えの再取得をご希望の場合は、研究者へお問い合わせください。"}
          </p>
          <a
            href={`mailto:${contactEmail}`}
            className="w-fit break-all underline"
          >
            {contactEmail}
          </a>
        </section>
      )}
    </CardSection>
  )
}
