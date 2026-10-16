"use client"

import { useCallback } from "react"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import { useAppContext } from "./app-context-provider"

export function useResetToStart() {
  const { resetToStart } = useAppContext()
  const { updateStatusMessage } = useMessageContext()
  return useCallback(async () => {
    try {
      const result = await resetToStart()
      if (result.ok) return
      if (result.reason === "superseded_operation") return
      if (result.reason === "result_clear_failed") {
        updateStatusMessage({
          message:
            "初期状態に戻りましたが、ブラウザー内の一時データを消去できませんでした。ブラウザーの保存設定を確認し、ページを再読み込みして再試行してください。",
          tone: "warning",
          recovery: "reload",
        })
        return
      }
      const sessionFailure = getSessionFailureStatus(result.reason)
      if (sessionFailure !== null) {
        updateStatusMessage(sessionFailure)
        return
      }
    } catch {
      // The server or browser storage can fail independently.
    }
    updateStatusMessage({
      message:
        "初期状態に戻せませんでした。入力を保持したまま、時間をおいて同じ操作を再試行してください。",
      tone: "error",
    })
  }, [resetToStart, updateStatusMessage])
}
