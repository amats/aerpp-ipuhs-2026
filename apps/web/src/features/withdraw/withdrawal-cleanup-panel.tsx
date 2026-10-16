"use client"

import { useEffect, useRef, useState } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import AlertMessage from "@/ui/alert-message"
import WithdrawalCleanupStatus from "./withdrawal-cleanup-status"

const CLEANUP_CHECK_INTERVAL_MS = 30_000

export default function WithdrawalCleanupPanel({
  autoRefresh = false,
}: {
  autoRefresh?: boolean
}) {
  const {
    completeWithdrawal,
    readWithdrawalCleanup,
    withdrawalCleanupStatus,
    sessionAdmission,
  } = useAppContext()
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const statusRef = useRef(withdrawalCleanupStatus)
  statusRef.current = withdrawalCleanupStatus

  useEffect(() => {
    if (sessionAdmission === "checking") return
    if (
      retry === 0 &&
      (statusRef.current === "complete" || statusRef.current === "localFailed")
    )
      return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function check() {
      if (
        !active ||
        statusRef.current === "complete" ||
        (statusRef.current === "localFailed" && retry === 0)
      )
        return
      setChecking(true)
      setFailed(false)
      let shouldRepeat = true
      try {
        const result = await (!autoRefresh && retry === 0
          ? readWithdrawalCleanup()
          : completeWithdrawal())
        if (!active) return
        setFailed(!result.ok)
        shouldRepeat =
          !result.ok ||
          result.cleanupPending === true ||
          result.stateWriteFailed === true
      } catch {
        if (active) setFailed(true)
      } finally {
        if (active) {
          setChecking(false)
          if (
            autoRefresh &&
            shouldRepeat &&
            statusRef.current !== "localFailed"
          )
            timer = setTimeout(check, CLEANUP_CHECK_INTERVAL_MS)
        }
      }
    }
    void check()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    autoRefresh,
    completeWithdrawal,
    readWithdrawalCleanup,
    retry,
    sessionAdmission,
  ])

  return (
    <>
      <WithdrawalCleanupStatus
        status={withdrawalCleanupStatus}
        autoRefresh={autoRefresh}
        checking={checking}
      />
      {checking && !autoRefresh && (
        <AlertMessage>
          データの消去状態を確認しています。結果が表示されるまでお待ちください。
        </AlertMessage>
      )}
      {failed && withdrawalCleanupStatus !== "complete" && (
        <AlertMessage tone="warning">
          消去状態を確認できませんでした。通信状態をご確認ください。
          {autoRefresh && withdrawalCleanupStatus !== "localFailed"
            ? "自動で再試行します。"
            : "「データ削除の再試行」を押してください。"}
          セッションが無効になっている場合や確認できない状態が続く場合は、研究担当者にご相談ください。
        </AlertMessage>
      )}
      {withdrawalCleanupStatus !== "complete" && (
        <button
          type="button"
          className="self-start rounded-lg border px-4 py-3 font-semibold disabled:opacity-50"
          disabled={checking}
          onClick={() => setRetry((value) => value + 1)}
        >
          データ削除の再試行
        </button>
      )}
    </>
  )
}
