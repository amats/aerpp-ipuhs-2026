"use client"

import { useRouter } from "next/navigation"
import { type ChangeEventHandler, useEffect, useRef, useState } from "react"
import Withdrawal from "@/assets/withdrawal.mdx"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import { EMAIL_REGEXP } from "@/features/auth/email-regexp"
import { useDebouncedEmailValidation } from "@/features/auth/use-debounced-email-validation"
import { requestWithdrawalPdf } from "@/features/pdf/document-client"
import { downloadPdf } from "@/features/pdf/download-pdf"
import ReloadPageButton from "@/features/session/reload-page-button"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import WithdrawalCleanupPanel from "@/features/withdraw/withdrawal-cleanup-panel"
import WithdrawalDataNotice from "@/features/withdraw/withdrawal-data-notice"
import WithdrawalRecoveryNotice from "@/features/withdraw/withdrawal-recovery-notice"
import AlertMessage from "@/ui/alert-message"
import CardSection from "@/ui/card-section"
import DateBadge from "@/ui/date-badge"
import EmailActionRow from "@/ui/email-action-row"
import RichTextBlock from "@/ui/rich-text-block"
import SectionHeading from "@/ui/section-heading"

export default function WithdrawPage({
  contactEmail,
}: {
  contactEmail: string
}) {
  const router = useRouter()
  const { completeWithdrawal, stage, withdrawalCleanupStatus } = useAppContext()

  const [cleanupPending, setCleanupPending] = useState(false)
  const [localCleanupFailed, setLocalCleanupFailed] = useState(false)
  const [email, setEmail] = useState("")
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreparingPdf, setIsPreparingPdf] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const requestGenerationRef = useRef(0)
  useEffect(() => {
    return () => {
      requestGenerationRef.current += 1
    }
  }, [])

  const { emailError: formatError, isValidationPending } =
    useDebouncedEmailValidation({
      email,
      invalidMessage: "有効なメールアドレスを入力してください。",
    })

  const isWithdrawn = stage === Stage.withdrawn
  const canWithdraw =
    isWithdrawn || stage === Stage.authenticated || stage === Stage.followUp
  const emailError = submissionError ?? formatError
  const isValidEmail =
    email.trim() !== "" && formatError === null && !isValidationPending
  const isSubmitDisabled = isSubmitting || !isValidEmail
  const errorId = "withdraw-email-error"

  const handleEmailChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const trimmedEmail = event.target.value.trim()
    setEmail(trimmedEmail)
    setSubmissionError(null)
    setLocalCleanupFailed(false)
  }

  async function downloadWithdrawalCopy() {
    const generation = requestGenerationRef.current
    setIsPreparingPdf(true)
    try {
      await downloadPdf(requestWithdrawalPdf)
      if (generation !== requestGenerationRef.current) return
      setPdfError(null)
      router.push("/")
    } catch {
      if (generation !== requestGenerationRef.current) return
      setPdfError(
        "同意撤回書のダウンロードに失敗しました。通信状態を確認し、再試行してください。",
      )
    } finally {
      if (generation === requestGenerationRef.current) setIsPreparingPdf(false)
    }
  }

  async function handleWithdrawalRequest(emailValue: string) {
    if (!canWithdraw) return
    const trimmedEmail = emailValue.trim()
    if (trimmedEmail === "") {
      setSubmissionError("メールアドレスを入力してください。")
      return
    }
    if (!EMAIL_REGEXP.test(trimmedEmail)) {
      setSubmissionError("有効なメールアドレスを入力してください。")
      return
    }
    setSubmissionError(null)
    setLocalCleanupFailed(false)
    setIsSubmitting(true)
    const generation = requestGenerationRef.current
    try {
      const result = await completeWithdrawal(trimmedEmail)
      if (generation !== requestGenerationRef.current) return
      if (result.ok !== true) {
        if (result.reason === "superseded_operation") return
        const sessionFailure = getSessionFailureStatus(result.reason)
        setSubmissionError(
          sessionFailure !== null
            ? sessionFailure.message
            : result.reason === "document_set_changed"
              ? "研究文書が更新されました。画面を再読み込みしてから撤回を申請してください。"
              : result.reason === "email_mismatch"
                ? "登録済みメールアドレスと一致しません。"
                : "撤回申請の結果を確認できませんでした。すでに受理されている可能性があります。同じメールアドレスで再試行してください。確認できない状態が続く場合は、研究担当者にご相談ください。",
        )
        return
      }
      setCleanupPending(result.cleanupPending === true)
      if (
        result.cleanupPending ||
        result.stateWriteFailed ||
        result.resultCleared === false
      ) {
        setLocalCleanupFailed(
          !result.stateWriteFailed &&
            !result.cleanupPending &&
            result.resultCleared === false,
        )
        setSubmissionError(
          result.stateWriteFailed
            ? "研究参加は撤回済みですが、撤回状態を保存できませんでした。消去状態の確認を再試行してください。"
            : result.cleanupPending
              ? "研究参加は撤回済みです。データの削除は完了していません。時間をおいて削除を再試行してください。"
              : "研究参加の撤回とサーバーのデータ削除は完了しました。ブラウザー内の一時データを消去できませんでした。ブラウザーの保存設定を確認し、「データ削除の再試行」を押してください。",
        )
      }
      // Receipt delivery is optional and cannot delay accepted-withdrawal UI.
      void downloadWithdrawalCopy()
    } catch {
      if (generation !== requestGenerationRef.current) return
      setSubmissionError(
        "撤回申請の結果を確認できませんでした。通信状態を確認し、同じメールアドレスで削除状態の確認を再試行してください。",
      )
    } finally {
      if (generation === requestGenerationRef.current) setIsSubmitting(false)
    }
  }

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Withdrawal"
        title={isWithdrawn ? "研究参加の撤回を受け付けました" : "同意の撤回"}
        description={
          isWithdrawn
            ? "研究への参加は終了しています。データの消去状況は、以下の表示をご確認ください。"
            : "メールアドレスを入力して同意撤回の手続きを申請してください。"
        }
      />
      {isWithdrawn && !isSubmitting && <WithdrawalCleanupPanel />}
      {isWithdrawn && !isSubmitting && (
        <WithdrawalRecoveryNotice contactEmail={contactEmail} />
      )}
      {!isWithdrawn && (
        <>
          <RichTextBlock>
            <Withdrawal />
          </RichTextBlock>
          <DateBadge />
          <WithdrawalDataNotice />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            同意撤回書は、撤回の受付が確認された時点で発行します。記載する日付は受付日です。データの消去状況は、受付後の画面でご確認ください。
          </p>
        </>
      )}
      {(isSubmitting || isPreparingPdf) && (
        <AlertMessage tone="info">
          <strong className="block text-lg font-semibold">
            {isPreparingPdf
              ? "同意撤回書を準備しています"
              : "撤回申請を送信し、結果を確認しています"}
          </strong>
          <span className="mt-2 block text-base leading-7">
            {isPreparingPdf
              ? "撤回申請は受理されています。書類を待たずに消去状況を確認できます。控えは「同意履歴・関連書類」からも取得できます。"
              : "同じ申請を繰り返し送信せず、結果が表示されるまでお待ちください。データの消去に時間がかかる場合は、受理後の画面で消去状況をご案内します。"}
          </span>
        </AlertMessage>
      )}
      {pdfError && !isPreparingPdf && (
        <AlertMessage tone="warning">
          撤回申請は受理されています。{pdfError}
          <span className="mt-2 block">
            <button
              type="button"
              className="font-semibold underline underline-offset-4"
              onClick={() => void downloadWithdrawalCopy()}
            >
              同意撤回書の取得を再試行
            </button>
          </span>
        </AlertMessage>
      )}
      {stage === Stage.unauthenticated && (
        <AlertMessage tone="info">
          このブラウザーでは参加登録を確認できません。参加登録をしたブラウザーで開き直してください。利用できない場合は、説明文書に記載された研究担当者に参加撤回をご連絡ください。撤回のために新たに参加登録する必要はありません。
        </AlertMessage>
      )}
      {stage === Stage.confirmationSent && (
        <AlertMessage tone="info">
          同意の撤回はメール認証の完了後に利用できます。届いたメールで認証を完了し、ホーム画面で「次に進む」を押して認証状態を確認してください。
        </AlertMessage>
      )}
      {canWithdraw && !isWithdrawn && (
        <EmailActionRow
          email={email}
          onChange={handleEmailChange}
          onSubmit={() => handleWithdrawalRequest(email)}
          disabled={isSubmitDisabled}
          readOnly={isSubmitting}
          hasError={Boolean(emailError)}
          inputId="withdraw-email"
          ariaLabel="メールアドレス"
          describedById={emailError ? errorId : undefined}
          buttonText={
            isSubmitting
              ? "送信しています..."
              : isWithdrawn || cleanupPending
                ? "データ削除の再試行"
                : "同意を撤回する"
          }
          buttonClassName="sm:w-60"
        />
      )}
      {emailError &&
        (!isWithdrawn ||
          (withdrawalCleanupStatus === "complete" &&
            !cleanupPending &&
            !localCleanupFailed)) && (
          <AlertMessage id={errorId} tone="error" className="-mt-2 text-base">
            {emailError}
            {localCleanupFailed && (
              <>
                {" "}
                <ReloadPageButton />
              </>
            )}
          </AlertMessage>
        )}
    </CardSection>
  )
}
