"use client"

import type { DocumentSetReference } from "@aerpp/config/document-set"
import { useEffect, useState } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { requestDocumentHistory } from "@/features/pdf/document-client"
import type { DocumentHistory as History } from "@/features/pdf/document-history-types"
import ReloadPageButton from "@/features/session/reload-page-button"
import {
  SESSION_ADMISSION_RETRY_MESSAGE,
  SESSION_RELOAD_MESSAGE,
  SESSION_RELOAD_NOTICE,
} from "@/features/session/session-recovery"
import { isBrowserSessionCurrent } from "@/lib/browser-session"
import { isRejectedSessionState } from "@/lib/session-failure"
import { readTabGeneration } from "@/lib/session-generation"
import { getTabToken } from "@/lib/tab-token"
import CardPanel from "@/ui/card-panel"
import { SECONDARY_BUTTON_CLASS_NAME, uiClassName } from "@/ui/ui-styles"
import DocumentHistoryPeriod, {
  formatDocumentDate,
} from "./document-history-period"

export default function DocumentHistory({
  currentSet,
}: {
  currentSet: DocumentSetReference
}) {
  const { sessionAdmission, canRetrySessionAdmission, retrySessionAdmission } =
    useAppContext()
  const [history, setHistory] = useState<History | null>(null)
  const [status, setStatus] = useState<
    "loading" | "failed" | "stale" | "ready"
  >("loading")
  const [reload, setReload] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retries repeat this read without changing session authority.
  useEffect(() => {
    setHistory(null)
    setStatus("loading")
    if (sessionAdmission !== "ready") return
    let current = true
    const token = getTabToken()
    const scope = readTabGeneration(token)
    void requestDocumentHistory(token)
      .then((result) => {
        if (
          current !== true ||
          (scope && isBrowserSessionCurrent(scope) !== true)
        )
          return
        if (result.ok === true) {
          setHistory(result.history)
          setStatus("ready")
        } else
          setStatus(
            isRejectedSessionState(result.reason) === true ? "stale" : "failed",
          )
      })
      .catch(() => {
        if (
          current === true &&
          (!scope || isBrowserSessionCurrent(scope) === true)
        )
          setStatus("failed")
      })
    return () => {
      current = false
    }
  }, [reload, sessionAdmission])

  if (sessionAdmission !== "ready" || status !== "ready" || history === null) {
    const admissionUnavailable = sessionAdmission === "unavailable"
    const needsReload =
      (admissionUnavailable && canRetrySessionAdmission !== true) ||
      (sessionAdmission === "ready" && status === "stale")
    return (
      <CardPanel
        as="section"
        aria-label="同意履歴"
        className="grid gap-3 p-4 sm:p-5"
      >
        <h2 className="text-lg font-semibold">今回の同意・撤回</h2>
        <p role="status">
          {admissionUnavailable
            ? canRetrySessionAdmission === true
              ? SESSION_ADMISSION_RETRY_MESSAGE
              : SESSION_RELOAD_MESSAGE
            : sessionAdmission !== "ready"
              ? "利用状態を確認しています。同意履歴は確認完了後に表示します。"
              : status === "stale"
                ? "利用状態が変わりました。画面を再読み込みして同意履歴を確認してください。"
                : status === "failed"
                  ? "同意履歴を取得できませんでした。時間をおいて再試行してください。"
                  : "同意履歴を確認しています…"}
        </p>
        {needsReload && (
          <>
            <p className="text-sm">{SESSION_RELOAD_NOTICE}</p>
            <ReloadPageButton
              className={uiClassName(
                SECONDARY_BUTTON_CLASS_NAME,
                "min-h-11 w-fit px-4 py-2",
              )}
            />
          </>
        )}
        {((admissionUnavailable && canRetrySessionAdmission === true) ||
          (sessionAdmission === "ready" && status === "failed")) && (
          <button
            type="button"
            className={uiClassName(
              SECONDARY_BUTTON_CLASS_NAME,
              "min-h-11 w-fit px-4 py-2",
            )}
            onClick={() =>
              admissionUnavailable
                ? retrySessionAdmission()
                : setReload((value) => value + 1)
            }
          >
            {admissionUnavailable ? "セッションの確認を再試行" : "再試行"}
          </button>
        )}
      </CardPanel>
    )
  }

  return (
    <>
      <CardPanel
        as="section"
        aria-labelledby="current-consent"
        className="min-w-0 p-4 sm:p-5"
      >
        <h2 id="current-consent" className="text-lg font-semibold">
          今回の同意・撤回
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          このブラウザーの利用に対応する同意と撤回の記録です。
        </p>
        <DocumentHistoryPeriod
          period={history.current}
          currentSet={currentSet}
          current
        />
      </CardPanel>
      {history.previous.length > 0 && (
        <section
          aria-labelledby="previous-consents"
          className="grid min-w-0 gap-3"
        >
          <h2 id="previous-consents" className="text-lg font-semibold">
            これまでの同意・撤回
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            同じメールアドレスで記録された、その他の同意と撤回です。日時はすべて日本時間です。
          </p>
          {history.previous.map((period) => (
            <CardPanel
              key={period.consent.id}
              as="details"
              className="min-w-0 p-4 sm:p-5"
            >
              <summary className="cursor-pointer rounded py-2 font-medium focus-visible:outline-2 focus-visible:outline-(--brand-blue)">
                同意：{formatDocumentDate(period.consent.date)} ／ v
                {period.consent.documentSet.version}
                {period.withdrawal && (
                  <>
                    {" "}
                    ／ 撤回：{formatDocumentDate(period.withdrawal.date)} ／ v
                    {period.withdrawal.documentSet.version}
                  </>
                )}
              </summary>
              <DocumentHistoryPeriod period={period} currentSet={currentSet} />
            </CardPanel>
          ))}
        </section>
      )}
    </>
  )
}
