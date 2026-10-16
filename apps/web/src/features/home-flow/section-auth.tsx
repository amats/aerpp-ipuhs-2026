"use client"

import { useEffect, useRef, useState } from "react"
import { resendConsentEmailAction } from "@/features/app-context/actions-step-state"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import { useResetToStart } from "@/features/app-context/use-reset-to-start"
import { useMessageContext } from "@/features/message/message-context-provider"
import { requestConsentPdf } from "@/features/pdf/document-client"
import { downloadPdf } from "@/features/pdf/download-pdf"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import SessionStateRecovery from "@/features/session/session-state-recovery"
import { runSessionMutation } from "@/lib/session-mutation"
import { isTabOperationCurrent } from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import { ACTION_ROW_CLASS_NAME, MUTED_TEXT_CLASS_NAME } from "@/ui/ui-styles"
import { useIntroNavigation } from "./use-intro-navigation"

export default function SectionAuth({
  authenticationEmailSender,
}: {
  authenticationEmailSender?: string
}) {
  const resetToStart = useResetToStart()
  const {
    confirmAuthentication,
    moveToExplanation,
    correctConsentEmail,
    stage,
  } = useAppContext()
  const correction = useIntroNavigation({
    moveNext: correctConsentEmail,
    failureMessage:
      "同意画面に戻れませんでした。時間をおいて再度お試しください。",
  })
  const { updateStatusMessage } = useMessageContext()
  const isStageAllowed = stage === Stage.confirmationSent

  const [isCheckingAuth, setIsCheckingAuth] = useState(false)
  const [canRestartConsent, setCanRestartConsent] = useState(false)

  const [isResending, setIsResending] = useState(false)
  const [resendWaitSeconds, setResendWaitSeconds] = useState(60)
  const resendAvailableAt = useRef(Date.now() + 60_000)
  const mounted = useRef(true)
  const resendInFlight = useRef(false)
  const isActionDisabled =
    isCheckingAuth || isResending || correction.isMovingNext

  useEffect(() => {
    mounted.current = true
    const interval = setInterval(() => {
      setResendWaitSeconds(
        Math.max(0, Math.ceil((resendAvailableAt.current - Date.now()) / 1000)),
      )
    }, 1000)
    return () => {
      mounted.current = false
      clearInterval(interval)
    }
  }, [])

  async function handleResend() {
    if (
      resendInFlight.current ||
      isActionDisabled ||
      Date.now() < resendAvailableAt.current
    )
      return
    resendInFlight.current = true
    setIsResending(true)
    try {
      const result = await runSessionMutation(() =>
        resendConsentEmailAction(getTabToken()),
      )
      if (!mounted.current || !isTabOperationCurrent()) return
      if (result.ok) {
        updateStatusMessage({
          message:
            "認証メールの再送を受け付けました。届いたメールを確認してください。すでにメール認証を完了している場合は再送されませんので、「次に進む」を押してください。",
          tone: "info",
        })
      } else {
        if (result.reason === "superseded_operation") return
        const sessionFailure = getSessionFailureStatus(result.reason)
        if (sessionFailure !== null) {
          updateStatusMessage(sessionFailure)
          return
        }
        const resetRequired = [
          "consent_expired",
          "consent_superseded",
          "consent_context_invalid",
        ].includes(result.reason)
        if (resetRequired) setCanRestartConsent(true)
        updateStatusMessage({
          message:
            result.reason === "send_rate_limited"
              ? "送信回数の上限に達したか、前回の送信から60秒経過していません。送信は1時間に5回までです。時間をおいて再度お試しください。"
              : resetRequired
                ? "この認証メールは再送できません。有効期限切れなどが考えられます。「同意手続きをやり直す」から、同意とメール認証をやり直してください。"
                : "認証メールの再送を確認できませんでした。時間をおいて再度お試しください。",
          tone: "error",
        })
      }
    } catch {
      if (!mounted.current || !isTabOperationCurrent()) return
      updateStatusMessage({
        message:
          "認証メールの再送を確認できませんでした。通信状態を確認し、時間をおいて再度お試しください。",
        tone: "error",
      })
    } finally {
      resendInFlight.current = false
      if (mounted.current) {
        resendAvailableAt.current = Date.now() + 60_000
        setResendWaitSeconds(60)
        setIsResending(false)
      }
    }
  }

  async function handleAuthenticationCheck() {
    setIsCheckingAuth(true)
    try {
      const authResult = await confirmAuthentication()
      if (!isTabOperationCurrent()) return
      if (!authResult.ok) {
        if (authResult.reason === "superseded_operation") return
        const sessionFailure = getSessionFailureStatus(authResult.reason)
        if (sessionFailure !== null) {
          updateStatusMessage(sessionFailure)
          return
        }
        if (
          [
            "auth_expired",
            "auth_superseded",
            "auth_invalid",
            "auth_unavailable",
            "initial_browser_required",
          ].includes(authResult.reason)
        ) {
          const messages: Record<string, string> = {
            auth_expired:
              "メール認証の有効期限が切れています。「同意手続きをやり直す」から、同意とメール認証をやり直してください。",
            auth_superseded:
              "復旧許可または参加状態の変更により、この認証は使用できなくなりました。研究責任者の案内を確認してください。",
            auth_invalid:
              "このメール認証を確認できません。「同意手続きをやり直す」から、同意とメール認証をやり直してください。",
            initial_browser_required:
              "初回解析を行ったブラウザーでアンケートを送信してください。送信完了まで別のブラウザーは利用できません。結果を失った場合は研究者にご連絡ください。",
            auth_unavailable:
              "認証状態を確認できませんでした。通信状態を確認し、時間をおいて再度お試しください。",
          }
          if (
            ["auth_expired", "auth_invalid", "auth_superseded"].includes(
              authResult.reason,
            )
          )
            setCanRestartConsent(true)
          updateStatusMessage({
            message: messages[authResult.reason],
            tone: "error",
          })
          return
        }
        if (authResult.reason === "not_ready") {
          updateStatusMessage({
            message:
              "まだ同意が完了していません。再度、同意とメールの登録を行ってください。",
            tone: "error",
          })
          await moveToExplanation()
          return
        }
        if (authResult.reason === "result_clear_failed") {
          updateStatusMessage({
            message:
              "メール認証は完了しましたが、ブラウザー内の一時データを消去できませんでした。ブラウザーの保存設定を確認し、ページを再読み込みして再試行してください。",
            tone: "warning",
            recovery: "reload",
          })
          return
        }
        if (
          authResult.reason === "step_state_write_failed" ||
          authResult.reason === "stage_mismatch" ||
          authResult.reason === "stage_resolution_failed" ||
          authResult.reason === "auth_mismatch"
        ) {
          updateStatusMessage({
            message:
              "状態の更新に失敗しました。時間をおいて再度お試しください。",
            tone: "error",
          })
          return
        }
        updateStatusMessage({
          message:
            "メール認証待ちです。届いたメールのリンクを開き、「メールアドレスを確認する」ボタンを押してから、もう一度「次に進む」を押してください。",
          tone: "error",
        })
        return
      }
      updateStatusMessage(null)
      const downloadToken = getTabToken()
      try {
        await downloadPdf(requestConsentPdf, { ordinaryOperation: true })
      } catch {
        // Optional receipt failures must not overwrite a newer business operation.
        if (!isTabOperationCurrent() || getTabToken() !== downloadToken) return
        updateStatusMessage({
          message:
            "メール認証は完了しています。同意書のダウンロードに失敗しました。「同意履歴・関連書類」から再度お試しください。",
          tone: "warning",
        })
      }
    } catch {
      if (!isTabOperationCurrent()) return
      updateStatusMessage({
        message:
          "認証の確認に失敗しました。通信状態を確認して、もう一度お試しください。",
        tone: "error",
      })
    } finally {
      setIsCheckingAuth(false)
    }
  }

  if (!isStageAllowed) {
    return <SessionStateRecovery />
  }

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Authentication"
        title="メールアドレス認証を行う"
      />
      <div className={`space-y-2 ${MUTED_TEXT_CLASS_NAME}`}>
        <p>
          登録したメールに認証のためのリンクが送信されます。リンクを開き、「メールアドレスを確認する」ボタンを押して認証を完了してください。
          {authenticationEmailSender &&
            `メールは、${authenticationEmailSender} から送信されます。`}
          迷惑メールフォルダに振り分けられる場合がありますので、ご注意ください。
        </p>
        <p>認証が完了したら、「次に進む」を押してください。</p>
        <p>
          メールが届かない場合は再送できます。送信は60秒間隔、1時間に5回までです。再送しても認証の有効期限は延長されません。
        </p>
      </div>
      <div className={ACTION_ROW_CLASS_NAME}>
        <ActionButton
          className="sm:mr-auto"
          variant="secondary"
          pending={correction.isMovingNext}
          pendingLabel="移動中..."
          disabled={isActionDisabled}
          onClick={() => void correction.handleMoveToNext()}
        >
          メールアドレスを訂正する
        </ActionButton>
        {canRestartConsent && (
          <ActionButton
            variant="secondary"
            disabled={isActionDisabled}
            onClick={() => void resetToStart()}
          >
            同意手続きをやり直す
          </ActionButton>
        )}
        <ActionButton
          variant="secondary"
          pending={isResending}
          pendingLabel="再送中..."
          onClick={() => void handleResend()}
          disabled={isActionDisabled || resendWaitSeconds > 0}
        >
          {resendWaitSeconds > 0
            ? `認証メールを再送（あと ${resendWaitSeconds} 秒）`
            : "認証メールを再送"}
        </ActionButton>
        <ActionButton
          pending={isCheckingAuth}
          pendingLabel="確認中..."
          onClick={() => void handleAuthenticationCheck()}
          disabled={isActionDisabled}
        >
          次に進む
        </ActionButton>
      </div>
    </CardSection>
  )
}
