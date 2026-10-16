"use client"

import { useState } from "react"

export default function OperationalQuery({ query }: { query: string }) {
  const [status, setStatus] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle")

  async function copyQuery() {
    setStatus("copying")
    try {
      await navigator.clipboard.writeText(query)
      setStatus("copied")
    } catch {
      setStatus("failed")
    }
  }

  return (
    <div className="mt-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyQuery}
          disabled={status === "copying"}
          aria-label="ログの検索条件をコピー"
          className="inline-flex min-h-8 items-center rounded-md border border-slate-300 px-2 text-xs font-medium text-(--brand) hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-white/5"
        >
          コピー
        </button>
        <p role="status" className="text-xs text-slate-600 dark:text-slate-300">
          {status === "copied"
            ? "コピーしました。"
            : status === "failed"
              ? "コピーできませんでした。下の検索条件を選択してコピーしてください。"
              : ""}
        </p>
      </div>
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Let keyboard users scroll investigation conditions.
        tabIndex={0}
        className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 text-xs dark:bg-white/5"
      >
        {query}
      </pre>
    </div>
  )
}
