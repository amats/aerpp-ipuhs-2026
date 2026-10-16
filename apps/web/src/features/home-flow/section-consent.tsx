"use client"

import {
  type ChangeEventHandler,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import Consent from "@/assets/consent.mdx"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { EMAIL_REGEXP } from "@/features/auth/email-regexp"
import { useDebouncedEmailValidation } from "@/features/auth/use-debounced-email-validation"
import type { ConsentChecks } from "@/features/home-flow/consent-draft-types"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import DateBadge from "@/ui/date-badge"
import EmailActionRow from "@/ui/email-action-row"
import { FieldError } from "@/ui/form-field"
import RichTextBlock from "@/ui/rich-text-block"
import SectionHeading from "@/ui/section-heading"
import { SURFACE_PANEL_CLASS_NAME, uiClassName } from "@/ui/ui-styles"
import { useIntroNavigation } from "./use-intro-navigation"

const CONSENT_SEND_UNCONFIRMED_MESSAGE =
  "メールの送信結果を確認できませんでした。すでに送信されている可能性があります。通信状態を確認し、同じメールアドレスで再試行してください。"

type ConsentCheckId = keyof ConsentChecks

const ConsentChecksContext = createContext<{
  checks: ConsentChecks
  onToggle: (id: ConsentCheckId) => void
} | null>(null)

function ConsentCheckBox({
  id,
  children,
}: {
  id: ConsentCheckId
  children: ReactNode
}) {
  const context = useContext(ConsentChecksContext)
  if (!context) {
    throw new Error("ConsentCheckBox must be rendered within SectionConsent")
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={context.checks[id]}
        onChange={() => context.onToggle(id)}
        className="h-4 w-4 rounded border-slate-300 bg-white text-(--brand-text) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--brand-blue)/60 dark:border-white/20 dark:bg-slate-900"
      />
      <label
        htmlFor={id}
        className="text-sm text-slate-700 dark:text-slate-200"
      >
        {children}
      </label>
    </div>
  )
}

const CONSENT_COMPONENTS = { CheckBox: ConsentCheckBox }

export default function SectionConsent() {
  const {
    prepareConsent,
    completeConsent,
    consentDraft,
    updateConsentDraft,
    moveToExplanation,
  } = useAppContext()
  const { updateStatusMessage } = useMessageContext()
  const previous = useIntroNavigation({
    moveNext: moveToExplanation,
    failureMessage:
      "説明画面に戻れませんでした。時間をおいて再度お試しください。",
  })

  const { email, checks: consentChecks } = consentDraft
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const { emailError: formatError, isValidationPending } =
    useDebouncedEmailValidation({
      email,
      invalidMessage: "本学の有効なメールアドレスを入力してください。",
    })

  const isAllConsentChecked = Object.values(consentChecks).every((v) => v)
  const emailError = submissionError ?? formatError
  const isValidEmail =
    email.trim() !== "" && formatError === null && !isValidationPending
  const [prepared, setPrepared] = useState<{
    email: string
    context: string
    request: number
  } | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [contextRequest, setContextRequest] = useState(0)
  const normalizedEmail = email.trim().toLowerCase()
  useEffect(() => {
    let current = true
    setPrepared(null)
    setContextError(null)
    if (!isValidEmail) return
    void prepareConsent(normalizedEmail)
      .then((result) => {
        if (!current) return
        if (result.ok)
          setPrepared({
            email: normalizedEmail,
            context: result.consentContext,
            request: contextRequest,
          })
        else
          setContextError(
            result.reason === "document_set_changed"
              ? "研究文書が更新されました。画面を再読み込みし、内容を確認してください。"
              : "参加状態の確認に失敗しました。再確認してください。",
          )
      })
      .catch(() => {
        if (current)
          setContextError("参加状態の確認に失敗しました。再確認してください。")
      })
    return () => {
      current = false
    }
  }, [normalizedEmail, isValidEmail, prepareConsent, contextRequest])
  const consentContext =
    prepared?.email === normalizedEmail && prepared.request === contextRequest
      ? prepared.context
      : null
  const isSubmitDisabled =
    isSendingEmail || !isAllConsentChecked || !isValidEmail || !consentContext

  const errorId = "consent-email-error"
  const emailDescriptionId = "consent-email-description"

  const handleEmailChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const trimmedEmail = event.target.value.trim()
    updateConsentDraft({ email: trimmedEmail })
    setSubmissionError(null)
  }

  function handleChangeConsentCheck(key: keyof typeof consentChecks) {
    updateConsentDraft({
      checks: { ...consentChecks, [key]: !consentChecks[key] },
    })
  }

  async function handleSendConsentEmail(email: string) {
    const trimmedEmail = email.trim()
    if (trimmedEmail === "") {
      setSubmissionError("メールアドレスを入力してください。")
      updateStatusMessage({
        message: "メールアドレスを入力してください。",
        tone: "error",
      })
      return
    }
    if (!EMAIL_REGEXP.test(trimmedEmail)) {
      setSubmissionError("本学の有効なメールアドレスを入力してください。")
      updateStatusMessage({
        message: "本学の有効なメールアドレスを入力してください。",
        tone: "error",
      })
      return
    }
    if (!consentContext || !isAllConsentChecked || !isValidEmail) return
    setSubmissionError(null)
    setIsSendingEmail(true)
    try {
      const consentResult = await completeConsent(trimmedEmail, consentContext)
      if (!consentResult.ok) {
        if (consentResult.reason === "superseded_operation") return
        if (consentResult.reason === "document_set_changed") {
          setPrepared(null)
          setContextError(
            "研究文書が更新されました。画面を再読み込みし、内容を確認してください。",
          )
          return
        }
        const sessionFailure = getSessionFailureStatus(consentResult.reason)
        if (sessionFailure !== null) {
          updateStatusMessage(sessionFailure)
          setSubmissionError(sessionFailure.message)
          return
        }
        if (
          [
            "consent_superseded",
            "consent_context_invalid",
            "consent_expired",
          ].includes(consentResult.reason)
        ) {
          setPrepared(null)
          setContextError(
            consentResult.reason === "consent_expired"
              ? "同意の確認から時間が経過しました。参加状態と同意項目を確認し直してください。"
              : "参加状態が変更されました。再確認してから、同意項目を確認し直してください。",
          )
          updateConsentDraft({
            checks: {
              understoodRisk: false,
              understoodWithdraw: false,
              agreeDataUsage: false,
              agreeParticipation: false,
            },
          })
          return
        }
        if (consentResult.reason === "send_rate_limited") {
          const message =
            "送信回数の上限に達したか、前回の送信から60秒経過していません。送信は1時間に5回までです。時間をおいて再度お試しください。"
          setSubmissionError(message)
          updateStatusMessage({ message, tone: "warning" })
          return
        }
        if (consentResult.reason === "step_state_write_failed") {
          updateStatusMessage({
            message:
              "状態の更新に失敗しました。時間をおいて再度お試しください。",
            tone: "error",
          })
          setSubmissionError(
            "状態の更新に失敗しました。時間をおいて再度お試しください。",
          )
        } else {
          updateStatusMessage({
            message: CONSENT_SEND_UNCONFIRMED_MESSAGE,
            tone: "error",
          })
          setSubmissionError(CONSENT_SEND_UNCONFIRMED_MESSAGE)
        }
        return
      }
      updateStatusMessage(null)
    } catch {
      setSubmissionError(CONSENT_SEND_UNCONFIRMED_MESSAGE)
      updateStatusMessage({
        message: CONSENT_SEND_UNCONFIRMED_MESSAGE,
        tone: "error",
      })
    } finally {
      setIsSendingEmail(false)
    }
  }

  return (
    <CardSection>
      <div className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Consent"
          title="承諾書"
          description="研究「倫理申請書類の解析を行うAIシステムの評価」について、以下の内容を確認し、同意される場合のみチェックを入れてください。"
        />
        <fieldset disabled={isSendingEmail}>
          <legend className="sr-only">研究参加への同意確認項目</legend>
          <RichTextBlock>
            <ConsentChecksContext
              value={{
                checks: consentChecks,
                onToggle: handleChangeConsentCheck,
              }}
            >
              <Consent components={CONSENT_COMPONENTS} />
            </ConsentChecksContext>
          </RichTextBlock>
        </fieldset>
      </div>
      <DateBadge />
      <ActionButton
        variant="secondary"
        className="sm:self-start"
        disabled={isSendingEmail}
        pending={previous.isMovingNext}
        onClick={() => void previous.handleMoveToNext()}
      >
        説明に戻る
      </ActionButton>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        説明・概要に戻っても、入力したメールアドレスとチェックは保持されます。
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        承諾書の控えには、このブラウザーでのメール認証により同意が確認された日を記載します。過去の控えは、書類の履歴から取得できます。
      </p>
      <div
        className={uiClassName(
          SURFACE_PANEL_CLASS_NAME,
          "grid gap-4 p-5 sm:p-6",
        )}
      >
        <div className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
          <label
            className="font-semibold text-slate-900 dark:text-slate-50"
            htmlFor="consent-email"
          >
            メールアドレス
          </label>
          <p
            id={emailDescriptionId}
            className="text-xs leading-relaxed text-slate-600 dark:text-slate-300"
          >
            メールアドレスの本人確認のためにメールを送信します。
            メールのリンクを開き、「メールアドレスを確認する」ボタンを押して認証を完了してください。
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          {emailError && (
            <FieldError
              id={errorId}
              role="alert"
              aria-live="assertive"
              className="max-w-xl"
            >
              {emailError}
            </FieldError>
          )}
          {contextError && (
            <div role="alert" className="space-y-3 text-sm">
              <p>{contextError}</p>
              <ActionButton
                variant="secondary"
                onClick={() => {
                  setContextError(null)
                  setContextRequest((value) => value + 1)
                }}
              >
                参加状態を再確認
              </ActionButton>
            </div>
          )}
          {isValidEmail && !consentContext && !contextError && (
            <p role="status" className="text-sm">
              参加状態を確認しています...
            </p>
          )}
          <EmailActionRow
            email={email}
            onChange={handleEmailChange}
            onSubmit={() => handleSendConsentEmail(email)}
            disabled={isSubmitDisabled}
            readOnly={isSendingEmail}
            hasError={Boolean(emailError)}
            describedById={
              emailError
                ? `${emailDescriptionId} ${errorId}`
                : emailDescriptionId
            }
            inputId="consent-email"
            buttonText={isSendingEmail ? "送信中..." : "同意する"}
          />
        </div>
      </div>
    </CardSection>
  )
}
