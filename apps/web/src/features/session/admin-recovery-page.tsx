"use client"

import { useEffect, useState } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { clearBrowserForAdminRecovery } from "@/lib/browser-session"
import { readTabGeneration } from "@/lib/session-generation"
import { cancelTabOperations } from "@/lib/tab-cancellation"
import { getTabToken, setTabToken } from "@/lib/tab-token"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import {
  type AdminRecoveryRequest,
  adminRecoveryResponseSchema,
} from "./admin-recovery-types"

async function recoveryRequest(body: AdminRecoveryRequest) {
  const response = await fetch("/api/admin-recovery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aerpp-tab": getTabToken() ?? "",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  })
  return adminRecoveryResponseSchema.parse(await response.json())
}

export default function AdminRecoveryPage() {
  const { sessionAdmission } = useAppContext()
  useEffect(() => {
    if (sessionAdmission === "ready") cancelTabOperations()
  }, [sessionAdmission])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  async function recover() {
    if (pending === true) return
    setPending(true)
    setMessage("")
    try {
      const checked = await recoveryRequest({ intent: "check" })
      if (checked.ok !== true) {
        setMessage(
          checked.reason === "recovery_not_authorized"
            ? "研究責任者の復旧許可がありません。研究責任者にお問い合わせください。"
            : "現在の状態を確認できませんでした。ページを再読み込みして再試行してください。",
        )
        return
      }
      const destination = {
        "initial-document": "初回の文書入力",
        "initial-survey": "指定された初回アンケート",
        "follow-up-document": "追加解析の文書入力",
      }[checked.recovery.destination]
      if (
        window.confirm(
          `${destination}への復旧を開始します。現在の文書・回答の入力は破棄されます。同じメールアドレスで同意・再認証してください。よろしいですか。`,
        ) !== true
      )
        return
      cancelTabOperations()
      const started = await recoveryRequest({
        intent: "begin",
        recoveryId: checked.recovery.recoveryId,
      })
      if (started.ok !== true) {
        setMessage(
          started.reason === "recovery_in_progress"
            ? "再認証の手続きが進んでいます。トップページで続けてください。"
            : "復旧を開始できませんでした。ページを再読み込みして復旧許可を再確認してください。",
        )
        return
      }
      // Keep the new stamp even if browser cleanup fails. Reload can resume the
      // same accepted reset, without repeating any Firestore write or inference.
      setTabToken(started.sessionToken)
      const scope = readTabGeneration(started.sessionToken)
      if (
        !scope ||
        !started.cleanupRevision ||
        (await clearBrowserForAdminRecovery(scope, started.cleanupRevision)) !==
          true
      )
        throw new Error("Recovery cleanup incomplete")
      const ready = await recoveryRequest({
        intent: "ready",
        recoveryId: started.recovery.recoveryId,
      })
      if (ready.ok !== true)
        throw new Error("Recovery cleanup acknowledgement failed")
      window.location.assign("/")
    } catch {
      setMessage(
        "復旧手続きの完了を確認できませんでした。ページを再読み込みし、再試行してください。",
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <CardSection className="mx-auto w-full max-w-2xl">
      <SectionHeading
        eyebrow="Recovery"
        title={
          <>
            研究責任者の許可による
            <span className="whitespace-nowrap">復旧</span>
          </>
        }
      />
      <p>
        復旧許可がある場合は、作業を中断し、指定された時点へ戻る手続きを行ってください。保存済みの研究データは保持し、このブラウザの文書・結果・未送信の回答を整理します。
      </p>
      <p>復旧後は、同じメールアドレスで同意・再認証が必要です。</p>
      <ActionButton
        onClick={() => void recover()}
        disabled={sessionAdmission === "checking"}
        pending={pending}
        pendingLabel="復旧手続き中..."
      >
        復旧許可を確認して進む
      </ActionButton>
      <p role="status">{message}</p>
      <a href="/" className="underline">
        トップページへ
      </a>
    </CardSection>
  )
}
