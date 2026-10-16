"use client"

import { useEffect, useRef, useState } from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { useMessageContext } from "@/features/message/message-context-provider"
import { resetSessionAction } from "@/features/reset/actions-reset"
import {
  beginBrowserReset,
  cancelBrowserReset,
  finishBrowserReset,
  isBrowserResetCurrent,
} from "@/lib/browser-session"
import {
  clearOriginBrowserDatabases,
  clearOriginLocalStorage,
} from "@/lib/browser-storage"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import {
  ACTION_ROW_CLASS_NAME,
  MUTED_TEXT_CLASS_NAME,
  SUBTLE_PANEL_CLASS_NAME,
  uiClassName,
} from "@/ui/ui-styles"

export default function ResetPage() {
  const { clearClientState } = useAppContext()
  const { clearClientMessages, updateStatusMessage } = useMessageContext()
  const [isResetting, setIsResetting] = useState(false)
  const resetGenerationRef = useRef(0)
  useEffect(() => {
    return () => {
      resetGenerationRef.current += 1
    }
  }, [])

  // Debug reset restores first-visit browser state regardless of in-flight work.
  // Origin cleanup is non-atomic and deliberately does not protect concurrent
  // work: it can interrupt other tabs and delete data saved after reset started.
  // Close other tabs and wait for completion before starting fresh work. Already
  // dispatched survey/withdrawal requests may still commit; accepted server
  // history and study eligibility are not erased by this browser reset.
  async function resetAllStoredValues() {
    setIsResetting(true)
    const generation = resetGenerationRef.current
    let target: Awaited<ReturnType<typeof beginBrowserReset>> | undefined
    let isBrowserResetFinished = false
    try {
      target = await beginBrowserReset()
      const result = await resetSessionAction(
        target.scope,
        target.replacementScope,
      )
      if (result.ok === true) {
        if ((await isBrowserResetCurrent(target)) !== true) return
        const applied = await finishBrowserReset(target)
        if (applied !== true) return
        isBrowserResetFinished = true
        // Publish invalidation before deleting the coordination database itself.
        await clearOriginBrowserDatabases()
        clearOriginLocalStorage()
        window.sessionStorage.clear()
        clearClientState()
        clearClientMessages({
          preserveStatusMessage: generation !== resetGenerationRef.current,
        })
      }
      if (result.ok !== true) await cancelBrowserReset(target)
      if (generation !== resetGenerationRef.current) return
      if (result.ok !== true) {
        updateStatusMessage({
          message:
            "初期化を完了できませんでした。時間をおいて再度お試しください。",
          tone: "error",
        })
        return
      }
      window.location.assign("/")
    } catch {
      // A finished reset has no marker to cancel. Reopening its database here
      // could wait behind a blocked deletion and prevent the failure UI.
      if (target !== undefined && isBrowserResetFinished !== true)
        await cancelBrowserReset(target).catch(() => {})
      if (generation !== resetGenerationRef.current) return
      updateStatusMessage({
        message:
          "保存データを初期化できませんでした。他のタブを閉じて再度お試しください。解消しない場合は、ブラウザーの設定からこのサイトの保存データを削除してください。",
        tone: "error",
      })
    } finally {
      if (generation === resetGenerationRef.current) {
        setIsResetting(false)
      }
    }
  }

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Reset App Data"
        title="保存データを初期化する"
        description="このサイトがブラウザーに保存したデータをすべて消去します。"
      />
      <div className="grid gap-3">
        <p
          className={uiClassName(
            SUBTLE_PANEL_CLASS_NAME,
            MUTED_TEXT_CLASS_NAME,
          )}
        >
          Cookie、Local Storage、Session
          Storage、IndexedDB、キャッシュなど、このサイトの保存データを消去します。入力した文書、未送信・送信確認待ちの回答、解析結果、表示設定も初期化されます。他のタブは閉じてから実行してください。
        </p>
        <p
          className={uiClassName(
            SUBTLE_PANEL_CLASS_NAME,
            MUTED_TEXT_CLASS_NAME,
          )}
        >
          送信済み、または送信中のアンケートや撤回は取り消されません。
          開始画面に戻り、同意とメール認証からやり直します。登録済みの参加データは撤回・削除されません。
        </p>
      </div>
      <div className={ACTION_ROW_CLASS_NAME}>
        <ActionButton
          pending={isResetting}
          pendingLabel="初期化しています..."
          onClick={() => void resetAllStoredValues()}
        >
          初期化する
        </ActionButton>
      </div>
    </CardSection>
  )
}
