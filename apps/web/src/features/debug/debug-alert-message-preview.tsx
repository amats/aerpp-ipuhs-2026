"use client"

import { useId, useState } from "react"

import DocumentFilePicker from "@/features/document/document-file-picker"
import LikertRadioFieldset from "@/features/survey/likert-radio-fieldset"
import AlertMessage from "@/ui/alert-message"
import CardPanel from "@/ui/card-panel"
import EmailActionRow from "@/ui/email-action-row"
import { CONTROL_CLASS_NAME, FieldError, FieldGroup } from "@/ui/form-field"
import { SECONDARY_BUTTON_CLASS_NAME } from "@/ui/ui-styles"

const tones = [
  {
    tone: "info" as const,
    title: "Info",
    message:
      "アップロード済みの原稿を確認しています。処理が終わるまでこのままお待ちください。",
  },
  {
    tone: "success" as const,
    title: "Success",
    message:
      "ファイルの解析が完了しました。抽出された本文をそのまま確認できます。",
  },
  {
    tone: "warning" as const,
    title: "Warning",
    message:
      "解析結果に不足している項目があります。提出前に内容を確認してください。",
  },
  {
    tone: "error" as const,
    title: "Error",
    message:
      "アンケートの送信に失敗しました。時間をおいて、もう一度お試しください。",
  },
]

const defaultVisibleState = {
  standard: true,
  compact: true,
}

export default function DebugAlertMessagePreview() {
  const previewId = useId()
  const emailErrorId = `${previewId}-email-error`
  const surveyErrorId = `${previewId}-survey-error`
  const [visibleState, setVisibleState] = useState(defaultVisibleState)
  const hasHiddenPreview = Object.values(visibleState).some(
    (isVisible) => !isVisible,
  )

  function handleDismiss(section: keyof typeof defaultVisibleState) {
    setVisibleState((currentState) => ({
      ...currentState,
      [section]: false,
    }))
  }

  function handleReset() {
    setVisibleState(defaultVisibleState)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <CardPanel className="flex min-w-0 flex-col gap-4 p-3 sm:p-5">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Standard
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              ベースの余白とアイコンの見え方を確認するための並びです。
            </p>
          </div>
          <button
            type="button"
            className={`${SECONDARY_BUTTON_CLASS_NAME} shrink-0 px-3 py-2 text-xs`}
            onClick={handleReset}
            disabled={!hasHiddenPreview}
          >
            再表示
          </button>
        </div>
        {visibleState.standard ? (
          <div className="flex flex-col gap-3">
            {tones.map(({ tone, title, message }) => (
              <AlertMessage
                key={`standard-${tone}`}
                tone={tone}
                onDismiss={() => handleDismiss("standard")}
              >
                <strong className="mr-1">{title}:</strong>
                {message}
              </AlertMessage>
            ))}
          </div>
        ) : (
          <DismissedState description="Standard セクションの alert は閉じられました。" />
        )}
      </CardPanel>

      <CardPanel className="flex min-w-0 flex-col gap-4 p-3 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Compact
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            小さな通知領域での余白とアイコンを確認できます。入力欄のエラーは下の赤いテキスト表示を使用します。
          </p>
        </div>
        {visibleState.compact ? (
          <div className="flex flex-col gap-2">
            {tones.map(({ tone, title, message }) => (
              <AlertMessage
                key={`compact-${tone}`}
                tone={tone}
                compact
                onDismiss={() => handleDismiss("compact")}
              >
                <strong className="mr-1">{title}:</strong>
                {message}
              </AlertMessage>
            ))}
          </div>
        ) : (
          <DismissedState description="Compact セクションの alert は閉じられました。" />
        )}
      </CardPanel>

      <CardPanel className="flex min-w-0 flex-col gap-4 p-3 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Upload Context
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            アップロード失敗時の通知が、中央寄せレイアウトの中でどう見えるかを確認できます。
          </p>
        </div>
        <DocumentFilePicker
          documentKey={`${previewId}-upload`}
          isParsing={false}
          sourceFileName={null}
          statusMessage={{
            tone: "error",
            message:
              "対応していないファイル形式です。DOCX、PPTX、テキスト、またはMarkdownを選択してください。",
          }}
          handleFiles={async () => {}}
          cancelImport={() => {}}
        />
        <p className="text-xs text-slate-600 dark:text-slate-300">
          表示確認用です。選択したファイルの読み込みは行いません。
        </p>
      </CardPanel>

      <CardPanel className="flex min-w-0 flex-col gap-4 p-3 sm:p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Form Context
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            メールアドレス入力欄の直前に、枠やアイコンのない赤いエラーテキストを表示します。
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldError
            id={emailErrorId}
            role="alert"
            aria-live="assertive"
            className="max-w-xl"
          >
            本学の有効なメールアドレスを入力してください。
          </FieldError>
          <EmailActionRow
            inputId={`${previewId}-email`}
            ariaLabel="メールアドレス（プレビュー）"
            email="invalid"
            onChange={() => {}}
            onSubmit={() => {}}
            readOnly
            disabled
            hasError
            describedById={emailErrorId}
            buttonText="同意する"
          />
        </div>
      </CardPanel>

      <CardPanel className="flex min-w-0 flex-col gap-4 p-3 sm:p-5 xl:col-span-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Survey Context
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            必須項目の未回答エラーを、選択欄・7段階評価・自由記述欄の近くに表示します。
          </p>
        </div>
        <FieldGroup>
          <label htmlFor={`${previewId}-survey-select`}>
            所属（プレビュー）
          </label>
          <FieldError id={surveyErrorId}>
            必須項目です。回答してください。
          </FieldError>
          <select
            id={`${previewId}-survey-select`}
            aria-invalid="true"
            aria-describedby={surveyErrorId}
            className={`${CONTROL_CLASS_NAME} border-red-500 dark:border-red-400`}
          >
            <option value="">選択してください</option>
          </select>
        </FieldGroup>
        <LikertRadioFieldset
          name={`${previewId}-survey-rating`}
          legend="使いやすさ（プレビュー）"
          value=""
          onChange={() => {}}
          options={["1", "2", "3", "4", "5", "6", "7"]}
          required
          errorMessage="必須項目です。回答してください。"
        />
        <FieldGroup>
          <label htmlFor={`${previewId}-survey-text`}>
            ご意見（プレビュー）
          </label>
          <FieldError id={`${surveyErrorId}-text`}>
            必須項目です。回答してください。
          </FieldError>
          <textarea
            id={`${previewId}-survey-text`}
            aria-invalid="true"
            aria-describedby={`${surveyErrorId}-text`}
            readOnly
            value=""
            className={`${CONTROL_CLASS_NAME} border-red-500 dark:border-red-400`}
          />
        </FieldGroup>
      </CardPanel>
    </div>
  )
}

function DismissedState({
  description,
  className,
}: {
  description: string
  className?: string
}) {
  return (
    <div
      className={[
        "rounded-xl border border-dashed border-slate-300/80 bg-slate-50/80 px-4 py-3 text-xs text-slate-600 dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-300",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {description}
    </div>
  )
}
