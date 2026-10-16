"use client"

import { useState } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"

export function useStartNewAnalysis() {
  const { prepareNewAnalysis } = useAppContext()
  const { updateStatusMessage } = useMessageContext()
  const [isPreparingAnalysis, setIsPreparingAnalysis] = useState(false)

  async function startNewAnalysis() {
    setIsPreparingAnalysis(true)
    try {
      const sessionResult = await prepareNewAnalysis()
      if (!sessionResult.ok && sessionResult.reason === "superseded_operation")
        return
      if (sessionResult.ok !== true && sessionResult.reason === "cancelled")
        return
      if (sessionResult.ok !== true) {
        updateStatusMessage(
          getSessionFailureStatus(sessionResult.reason) ?? {
            message:
              sessionResult.reason === "submission_pending"
                ? "アンケートの送信結果を確認してから消去してください。同じ回答で再送して確認できます。"
                : "状態の更新に失敗しました。時間をおいて再度お試しください。",
            tone: "error",
          },
        )
      } else if (!sessionResult.resultCleared) {
        updateStatusMessage({
          message:
            "ブラウザー内の一時データの消去を完了できませんでした。ブラウザーの保存設定を確認して、消去を再試行してください。",
          tone: "warning",
          recovery: "reload",
        })
      } else {
        updateStatusMessage(null)
      }
    } catch {
      updateStatusMessage({
        message: "状態の更新に失敗しました。時間をおいて再度お試しください。",
        tone: "error",
      })
    } finally {
      setIsPreparingAnalysis(false)
    }
  }

  return { isPreparingAnalysis, startNewAnalysis }
}
