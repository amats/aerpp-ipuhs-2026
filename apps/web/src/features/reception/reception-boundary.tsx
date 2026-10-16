"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { cancelTabOperations } from "@/lib/tab-cancellation"
import { getReceptionStatusAction } from "./actions-reception"
import ReceptionClosed from "./reception-closed"

export default function ReceptionBoundary({
  remainingMs,
  contactEmail,
  children,
}: {
  remainingMs: number
  contactEmail: string
  children: ReactNode
}) {
  const [closed, setClosed] = useState(remainingMs <= 0)
  const content = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (closed) {
      cancelTabOperations()
      content.current?.querySelector("h1")?.focus()
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    // Elapsed time comes from a monotonic clock, not the browser's date setting.
    let deadline = performance.now() + remainingMs
    const check = () => {
      clearTimeout(timer)
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        cancelTabOperations()
        setClosed(true)
      } else {
        timer = setTimeout(check, Math.min(remaining, 60_000))
      }
    }
    const synchronize = async () => {
      try {
        const status = await getReceptionStatusAction()
        if (disposed) return
        // The server measures remaining time after the request has reached it.
        // Counting from request start would subtract outbound/queue delay twice.
        // Never extend a known deadline, even for a delayed older response.
        deadline = Math.min(deadline, performance.now() + status.remainingMs)
        check()
      } catch {
        // A transport failure never extends the last known reception deadline.
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void synchronize()
    }
    check()
    void synchronize()
    window.addEventListener("focus", synchronize)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      disposed = true
      clearTimeout(timer)
      window.removeEventListener("focus", synchronize)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [closed, remainingMs])

  return closed ? (
    <div ref={content}>
      <ReceptionClosed contactEmail={contactEmail} />
    </div>
  ) : (
    children
  )
}
