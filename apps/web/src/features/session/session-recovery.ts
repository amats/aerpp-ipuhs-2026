import type { StatusMessage } from "@/features/message/message-context-types"
import { isRejectedSessionState } from "@/lib/session-failure"
import { SESSION_BUSY_MESSAGE } from "@/lib/session-mutation"

export const SESSION_ADMISSION_RETRY_MESSAGE =
  "セッションを確認できませんでした。通信状態やブラウザーの保存設定を確認し、セッションの確認を再試行してください。"
export const SESSION_RELOAD_MESSAGE =
  "現在の画面とセッションの状態が一致しないか、セッションを確認できません。ページを再読み込みして現在の状態を確認してください。"
export const SESSION_RELOAD_NOTICE =
  "再読み込みすると、入力中の書類、未送信の回答、同意画面の入力は失われます。保存済みの結果と再送用の回答は、有効なセッションであれば再利用できます。"

export function getSessionFailureStatus(reason: unknown): StatusMessage | null {
  if (reason === "recovery_authentication_required")
    return {
      message:
        "復旧用の認証手続きが進んでいます。届いたメールで認証し、「次に進む」を押してください。同意のやり直しは、有効期限切れを確認した場合に行えます。",
      tone: "warning",
    }
  if (reason === "session_busy")
    return { message: SESSION_BUSY_MESSAGE, tone: "warning" }
  if (isRejectedSessionState(reason) === true)
    return {
      message: SESSION_RELOAD_MESSAGE,
      tone: "error",
      recovery: "reload",
    }
  return null
}
