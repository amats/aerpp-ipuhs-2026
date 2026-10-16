"use client"

import { Activity, useId } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import SessionStateRecovery from "@/features/session/session-state-recovery"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import {
  ACTION_ROW_CLASS_NAME,
  MUTED_TEXT_CLASS_NAME,
  SECONDARY_BUTTON_CLASS_NAME,
  uiClassName,
} from "@/ui/ui-styles"
import { DOCUMENT_CONSTRAINTS } from "./document-constraints"
import DocumentFilePicker from "./document-file-picker"
import DocumentTabChip from "./document-tab-chip"
import TextEditor from "./text-editor"
import { useDocumentEditor } from "./use-document-editor"

export default function SectionDocument() {
  const analysisHintId = useId()
  const { stage } = useAppContext()
  const isStageAllowed =
    stage === Stage.authenticated || stage === Stage.followUp

  const {
    activeDocumentKey,
    addDocument,
    canProceed,
    analysisDisabledReason,
    clearDocument,
    documentKeys,
    documentNames,
    documents,
    handleFiles,
    cancelImport,
    handleStartAnalysis,
    handleTabKeyDown,
    isParsing,
    isStartingAnalysis,
    removeDocument,
    registerTabButtonRef,
    statusMessages,
    titles,
    documentBodyGraphemeCounts,
    updateActiveDocumentKey,
    updateDocument,
    updateDocumentName,
    sourceFileNames,
  } = useDocumentEditor()

  const maxTotalGraphemes = DOCUMENT_CONSTRAINTS.maxTotalGraphemes

  if (!isStageAllowed) {
    return <SessionStateRecovery />
  }

  return (
    <CardSection>
      <div className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Documents"
          title="倫理申請書類の解析を準備する"
          description="倫理審査に提出する文書を追加してください。各文書の名前と本文をもとに、書類全体を解析します。"
        />
        <p className={MUTED_TEXT_CLASS_NAME}>
          解析はAERPPの学内サーバーで行われます。書類が外部のLLMサービスへ送信されることはありません。
        </p>
        <p className={MUTED_TEXT_CLASS_NAME}>
          書類名と本文の合計が、{maxTotalGraphemes.toLocaleString()}
          字以下になるようにしてください。
        </p>
      </div>

      <fieldset
        disabled={isStartingAnalysis}
        className="flex min-w-0 flex-col gap-5"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="flex min-w-0 flex-wrap items-center gap-2.5"
            role="tablist"
            aria-label="申請書類"
          >
            {documentKeys.map((key) => {
              const title = titles[key]
              const tabId = `doc-tab-${key}`
              const panelId = `doc-panel-${key}`
              const graphemeCount = documentBodyGraphemeCounts[key] ?? 0
              const isActive = key === activeDocumentKey
              return (
                <DocumentTabChip
                  key={tabId}
                  documentKey={key}
                  title={title}
                  graphemeCount={graphemeCount}
                  isActive={isActive}
                  tabId={tabId}
                  panelId={panelId}
                  tabIndex={isActive ? 0 : -1}
                  onSelect={updateActiveDocumentKey}
                  onKeyDown={handleTabKeyDown(key)}
                  ref={(element) => {
                    registerTabButtonRef(key, element)
                  }}
                />
              )
            })}
          </div>
          <button
            type="button"
            disabled={
              isParsing ||
              documentKeys.length >= DOCUMENT_CONSTRAINTS.maxDocuments
            }
            onClick={addDocument}
            className="rounded-lg border border-dashed border-(--brand-blue)/50 px-3.5 py-2 text-sm font-semibold text-(--brand-text) transition-colors duration-200 hover:border-(--brand-blue) hover:bg-(--brand-blue)/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-(--brand-blue)/60"
            title="書類を追加"
          >
            + 書類を追加
          </button>
        </div>

        {documentKeys.map((key) => {
          const tabId = `doc-tab-${key}`
          const panelId = `doc-panel-${key}`
          const document = documents[key]
          const sourceFileName = sourceFileNames[key]
          const statusMessage = statusMessages[key]
          return (
            <Activity
              mode={key === activeDocumentKey ? "visible" : "hidden"}
              key={key}
            >
              <div
                role="tabpanel"
                id={panelId}
                aria-labelledby={tabId}
                className="flex min-w-0 flex-col gap-3 border-t border-slate-200/70 pt-4 sm:rounded-xl sm:border sm:bg-white/70 sm:p-5 dark:border-white/10 sm:dark:bg-slate-950/30"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor={`document-name-${key}`}
                    className="text-sm font-semibold"
                  >
                    書類名
                  </label>
                  {documentKeys.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDocument(key)}
                      disabled={isParsing}
                      aria-label={`${titles[key]} を削除`}
                      className={uiClassName(
                        SECONDARY_BUTTON_CLASS_NAME,
                        "min-h-11 px-3 py-2",
                      )}
                    >
                      この書類を削除
                    </button>
                  )}
                </div>
                <input
                  id={`document-name-${key}`}
                  type="text"
                  value={documentNames[key] ?? ""}
                  disabled={isParsing}
                  onChange={(event) =>
                    updateDocumentName(key, event.target.value)
                  }
                  maxLength={DOCUMENT_CONSTRAINTS.maxDocumentNameCodeUnits}
                  placeholder="例：研究計画書、説明文書、同意書"
                  className="rounded-lg border border-slate-300 bg-transparent px-3 py-2"
                />
                <TextEditor
                  documentKey={key}
                  documentTitle={titles[key]}
                  document={document}
                  disabled={isParsing}
                  onChange={updateDocument}
                  onClear={clearDocument}
                />
                {!document && (
                  <DocumentFilePicker
                    documentKey={key}
                    isParsing={isParsing}
                    sourceFileName={sourceFileName}
                    statusMessage={statusMessage}
                    handleFiles={handleFiles}
                    cancelImport={cancelImport}
                  />
                )}
              </div>
            </Activity>
          )
        })}
      </fieldset>

      <div className="flex flex-col gap-3">
        <p id={analysisHintId} role="status" className={MUTED_TEXT_CLASS_NAME}>
          {isStartingAnalysis
            ? "解析を開始しています。しばらくお待ちください。"
            : isParsing
              ? "ファイルを読み込んでいます。完了するまでお待ちください。"
              : (analysisDisabledReason ??
                "すべての文書を確認したら解析を開始してください。")}
        </p>
        <div className={ACTION_ROW_CLASS_NAME}>
          <ActionButton
            pending={isStartingAnalysis}
            pendingLabel="開始しています..."
            aria-describedby={analysisHintId}
            disabled={!canProceed || isParsing}
            onClick={() => void handleStartAnalysis()}
          >
            解析を開始する
          </ActionButton>
        </div>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        ブラウザーを閉じて終了できます。入力中の文書は保存されないため、再開する場合はもう一度登録してください。
      </p>
    </CardSection>
  )
}
