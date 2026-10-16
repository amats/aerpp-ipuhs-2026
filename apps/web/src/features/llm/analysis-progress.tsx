"use client"

import { useEffect, useState } from "react"
import type { AnalysisElapsedTime } from "./analysis-job-types"

function AnalysisElapsedCounter({
  initialElapsedTime,
}: {
  initialElapsedTime: AnalysisElapsedTime
}) {
  // Seed once on mount/reload; status polling must not correct the display clock.
  const [seconds, setSeconds] = useState(() =>
    Math.floor(
      (initialElapsedTime.elapsedMs +
        Math.max(0, performance.now() - initialElapsedTime.receivedAtMs)) /
        1000,
    ),
  )
  useEffect(() => {
    // Wait a full second after each rendered tick, without catching up after delays.
    const timer = setTimeout(() => setSeconds(seconds + 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  return `経過時間 ${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`
}

export default function AnalysisProgress({
  elapsedTime,
  label = "解析結果を待っています。",
}: {
  elapsedTime: AnalysisElapsedTime | null
  label?: string
}) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (elapsedTime !== null) return
    const timer = setTimeout(() => setSlow(true), 15_000)
    return () => clearTimeout(timer)
  }, [elapsedTime])
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        data-analysis-animation
        className="h-7 w-7 shrink-0 animate-spin rounded-full border-3 border-blue-200 border-t-blue-700 motion-reduce:animate-none dark:border-blue-900 dark:border-t-blue-300"
      />
      <div className="grid gap-1">
        <p role="status" className="font-semibold">
          {label}
        </p>
        <p className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
          {elapsedTime !== null ? (
            <AnalysisElapsedCounter initialElapsedTime={elapsedTime} />
          ) : slow ? (
            "処理状況の確認に時間がかかっています。しばらくお待ちください。"
          ) : (
            "処理状況を確認しています。"
          )}
        </p>
      </div>
    </div>
  )
}
