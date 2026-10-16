"use client"

import { useEffect, useId, useRef, useState } from "react"
import { downloadPdf } from "@/features/pdf/download-pdf"
import type { PdfDownloadResult } from "@/features/pdf/pdf-download-types"
import {
  PRIMARY_BUTTON_CLASS_NAME,
  SECONDARY_BUTTON_CLASS_NAME,
  uiClassName,
} from "@/ui/ui-styles"

export default function DocumentDownloadRow({
  label,
  loadPdf,
  primary = false,
  disabled = false,
  hint,
}: {
  label: string
  loadPdf: (token?: string) => Promise<PdfDownloadResult>
  primary?: boolean
  disabled?: boolean
  hint?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const generationRef = useRef(0)
  const activeRef = useRef(false)
  const descriptionId = useId()
  const buttonText =
    busy === true
      ? "PDFを準備しています…"
      : error !== ""
        ? "再試行（PDF）"
        : "PDFをダウンロード"
  useEffect(
    () => () => {
      generationRef.current += 1
    },
    [],
  )

  async function download() {
    if (disabled !== false || activeRef.current === true) return
    const generation = generationRef.current
    activeRef.current = true
    setBusy(true)
    setError("")
    try {
      await downloadPdf(loadPdf)
    } catch (error) {
      if (generation === generationRef.current)
        setError(
          error instanceof Error && error.message.trim() !== ""
            ? error.message
            : "書類を取得できませんでした。時間をおいて再試行してください。",
        )
    } finally {
      if (generation === generationRef.current) {
        activeRef.current = false
        setBusy(false)
      }
    }
  }

  return (
    <li className="grid gap-2 border-t border-slate-200/80 py-3 first:border-t-0 dark:border-white/10">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium">{label}</span>
        <button
          type="button"
          className={uiClassName(
            primary === true
              ? PRIMARY_BUTTON_CLASS_NAME
              : SECONDARY_BUTTON_CLASS_NAME,
            "min-h-11 shrink-0 px-4 py-2",
          )}
          aria-label={`${label}：${buttonText}`}
          aria-describedby={error !== "" || hint ? descriptionId : undefined}
          aria-busy={busy}
          disabled={disabled !== false || busy === true}
          onClick={() => void download()}
        >
          {buttonText}
        </button>
      </div>
      {(hint || error !== "") && (
        <div id={descriptionId}>
          {hint && (
            <p className="text-sm text-slate-600 dark:text-slate-300">{hint}</p>
          )}
          {error !== "" && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
      {busy === true && (
        <p role="status" className="text-sm">
          {label}を準備しています。しばらくお待ちください。
        </p>
      )}
    </li>
  )
}
