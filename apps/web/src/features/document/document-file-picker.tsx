import {
  type ChangeEventHandler,
  type DragEventHandler,
  useId,
  useRef,
  useState,
} from "react"
import AlertMessage from "@/ui/alert-message"
import type { AlertTone } from "@/ui/alert-tone"
import { FieldError } from "@/ui/form-field"
import { DOCUMENT_ACCEPT_TYPES } from "./document-constraints"
import { DOCUMENT_IMPORT_CONSTRAINTS as limits } from "./document-import-constraints"

export default function DocumentFilePicker({
  documentKey,
  isParsing,
  sourceFileName,
  statusMessage,
  handleFiles,
  cancelImport,
}: {
  documentKey: string
  isParsing: boolean
  cancelImport: () => void
  sourceFileName: string | null
  statusMessage?: { tone?: AlertTone; message: string }
  handleFiles: (
    key: string,
    files: FileList | readonly File[] | null,
  ) => Promise<void>
}) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const descriptionId = useId()
  const statusId = useId()
  const describedBy = statusMessage
    ? `${descriptionId} ${statusId}`
    : descriptionId

  const handleFileInputChange: ChangeEventHandler<HTMLInputElement> = async (
    event,
  ) => {
    const files = event.target.files ? Array.from(event.target.files) : null
    event.target.value = ""
    await handleFiles(documentKey, files)
  }

  const handleDrop: DragEventHandler<HTMLDivElement> = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    if (isParsing) return
    await handleFiles(documentKey, Array.from(event.dataTransfer.files))
  }

  const handleDragOver: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!isParsing && !isDragging) {
      setIsDragging(true)
    }
  }

  const handleDragLeave: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const relatedTarget = event.relatedTarget as Node | null
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
      return
    }
    setIsDragging(false)
  }

  function openFileDialog() {
    fileInputRef.current?.click()
  }

  return (
    <section
      aria-label="ファイル読み込みエリア"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-3 text-center sm:p-6 transition-colors ${
        isDragging
          ? "border-(--brand-blue) bg-(--brand-blue)/10"
          : "border-slate-300/80 bg-white/60 dark:border-white/10 dark:bg-slate-900/40"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        tabIndex={-1}
        disabled={isParsing}
        accept={DOCUMENT_ACCEPT_TYPES}
        aria-label="解析する書類ファイルを選択"
        aria-describedby={describedBy}
        className="sr-only"
        onChange={handleFileInputChange}
      />
      <button
        type="button"
        onClick={openFileDialog}
        disabled={isParsing}
        aria-describedby={describedBy}
        className="rounded-full border border-(--brand-blue)/60 bg-white/80 px-4 py-2 text-sm font-semibold text-(--brand-text) shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue) hover:border-(--brand-blue) hover:bg-(--brand-blue)/10 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 dark:bg-slate-900 dark:hover:bg-slate-800"
      >
        {isParsing ? "読み込み中..." : "ファイルを選択"}
      </button>
      {isParsing === true ? (
        <button
          type="button"
          onClick={cancelImport}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          読み込みを中止
        </button>
      ) : null}
      {sourceFileName ? (
        <p
          id={descriptionId}
          className="max-w-xl wrap-anywhere text-sm font-medium text-slate-600 dark:text-slate-200"
        >
          選択中のファイル: {sourceFileName}
        </p>
      ) : (
        <p
          id={descriptionId}
          className="max-w-xl wrap-anywhere text-sm leading-relaxed text-slate-500 dark:text-slate-300"
        >
          DOCXファイル、PPTXファイル、テキストファイル、Markdownファイルをドラッグ＆ドロップするか、ボタンから選択すると自動でテキストに変換されて入力されます。
          テキスト・Markdownは{limits.maxTextFileBytes / 1_000_000}
          MBまで読み込めます。
          DOCファイルはサポートされていません。端末内のMicrosoft
          Wordなどで、クラウドへのアップロードや同期を行わずにDOCX形式へ変換してください。
        </p>
      )}
      {statusMessage?.tone === "error" ? (
        <FieldError
          id={statusId}
          role="alert"
          aria-live="assertive"
          className="w-full max-w-xl text-left"
        >
          {statusMessage.message}
        </FieldError>
      ) : statusMessage ? (
        <AlertMessage
          tone={statusMessage.tone ?? "info"}
          compact
          id={statusId}
          className="w-full max-w-xl text-left"
        >
          {statusMessage.message}
        </AlertMessage>
      ) : null}
    </section>
  )
}
