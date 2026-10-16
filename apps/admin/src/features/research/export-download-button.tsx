"use client"

import { useEffect, useRef, useState } from "react"

const FAILURE_MESSAGE =
  "元データを取得できませんでした。出力は完了していません。時間をおいて、もう一度保存ボタンを押してください。"

export default function ExportDownloadButton({
  dataset,
  label,
}: {
  dataset: "research" | "access"
  label: string
}) {
  const [status, setStatus] = useState<
    "idle" | "pending" | "error" | "started" | "cancelled"
  >("idle")
  const requestRef = useRef<AbortController | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(
    () => () => {
      requestRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    if (status === "cancelled") buttonRef.current?.focus()
  }, [status])

  function isCurrentRequest(controller: AbortController) {
    return (
      requestRef.current === controller && controller.signal.aborted !== true
    )
  }

  function cancelWaiting() {
    const controller = requestRef.current
    if (controller === null) return
    requestRef.current = null
    controller.abort()
    setStatus("cancelled")
  }

  async function download() {
    if (requestRef.current !== null) return
    const controller = new AbortController()
    requestRef.current = controller
    setStatus("pending")
    try {
      const response = await fetch(
        `/api/research/export?dataset=${dataset}&format=bundle`,
        {
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      )
      if (isCurrentRequest(controller) !== true) return
      const filename = response.headers
        .get("Content-Disposition")
        ?.match(
          new RegExp(
            `^attachment; filename="(${dataset}-source-[a-f0-9-]+\\.zip)"$`,
          ),
        )?.[1]
      if (
        response.ok !== true ||
        response.headers.get("Content-Type") !== "application/zip" ||
        !filename
      )
        throw new Error("Export response unavailable")
      const blob = await response.blob()
      if (isCurrentRequest(controller) !== true) return
      if (blob.size === 0) throw new Error("Empty export response")
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.append(link)
      try {
        link.click()
      } finally {
        link.remove()
        // Let the browser read the blob before releasing the download URL.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
      setStatus("started")
    } catch {
      if (isCurrentRequest(controller) === true) setStatus("error")
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => void download()}
        disabled={status === "pending"}
        aria-busy={status === "pending"}
        className="inline-flex min-h-11 w-fit items-center rounded-lg bg-(--brand-solid) px-4 py-2 font-semibold text-(--brand-on-solid) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand) disabled:opacity-60"
      >
        {status === "pending" ? "ZIPを準備しています…" : label}
      </button>
      {status === "pending" && (
        <button
          type="button"
          onClick={cancelWaiting}
          aria-label={`${label}の待機を中止`}
          className="inline-flex min-h-11 w-fit items-center rounded-lg border border-current px-4 py-2 font-semibold text-(--brand) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand)"
        >
          待機を中止
        </button>
      )}
      {status === "error" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {FAILURE_MESSAGE}
        </p>
      )}
      <p role="status" className="text-sm">
        {status === "pending"
          ? "データを取得しています。完了までこの画面でお待ちください。"
          : status === "cancelled"
            ? "ZIPの取得待機を中止しました。もう一度保存できます。"
            : status === "started"
              ? "ダウンロードを開始しました。ブラウザーの保存状況を確認してください。"
              : ""}
      </p>
    </div>
  )
}
