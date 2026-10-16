"use client"

import { useEffect, useEffectEvent, useRef } from "react"

export default function TextEditor({
  documentKey,
  documentTitle,
  document,
  disabled = false,
  onChange,
  onClear,
}: {
  documentKey: string
  documentTitle: string
  document: string
  disabled?: boolean
  onChange: (key: string, value: string) => void
  onClear: (key: string) => void
}) {
  const textareaId = `document-content-${documentKey}`
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const restoreDraftValue = useEffectEvent(() => {
    const textarea = textareaRef.current
    if (textarea && textarea.value !== document) textarea.value = document
  })

  useEffect(() => {
    let frame: number
    function queueDraftRestoration() {
      window.cancelAnimationFrame(frame)
      // Browsers can restore form values after pageshow, without React events.
      frame = window.requestAnimationFrame(restoreDraftValue)
    }
    queueDraftRestoration()
    window.addEventListener("pageshow", queueDraftRestoration)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("pageshow", queueDraftRestoration)
    }
  }, [])

  return (
    <section aria-label="テキスト編集エリア" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label
          htmlFor={textareaId}
          className="min-w-0 wrap-anywhere text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          {documentTitle}
        </label>
        <div className="flex shrink-0 justify-end">
          <button
            type="button"
            onClick={() => onClear(documentKey)}
            disabled={disabled}
            className="min-h-11 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-white/15 dark:text-slate-300 dark:hover:border-white/30 dark:hover:text-slate-100"
          >
            本文をクリア
          </button>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        id={textareaId}
        name="document-content"
        value={document}
        // Native history restoration must not replace only the DOM value.
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange(documentKey, e.target.value)}
        rows={12}
        placeholder="ここに申請書類を貼り付けることや、直接入力することもできます。崩れたフォーマットや箇条書きのままでも解析できます。"
        className="w-full rounded-xl border border-slate-200 bg-white/95 p-3 text-sm leading-relaxed text-slate-900 transition-colors focus:border-(--brand-blue) focus:ring-2 focus:ring-(--brand-blue)/40 focus:outline-none dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-100"
      />
    </section>
  )
}
