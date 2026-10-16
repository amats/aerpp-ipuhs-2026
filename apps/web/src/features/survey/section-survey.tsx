"use client"

import {
  type ChangeEventHandler,
  Fragment,
  type SubmitEventHandler,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import SectionThanks from "@/features/home-flow/section-thanks"
import { useStartNewAnalysis } from "@/features/home-flow/use-start-new-analysis"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import SessionStateRecovery from "@/features/session/session-state-recovery"
import LikertRadioFieldset from "@/features/survey/likert-radio-fieldset"
import { SURVEY_TEXT_ANSWER_MAX_GRAPHEMES } from "@/features/survey/survey-answer-constraints"
import type { SurveyAnswer } from "@/features/survey/survey-answer-types"
import type {
  SurveyQuestion,
  SurveyQuestionSet,
} from "@/features/survey/survey-question-types"
import { countGraphemes } from "@/lib/graphemes"
import { SESSION_BUSY_MESSAGE } from "@/lib/session-mutation"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import { CONTROL_CLASS_NAME, FieldError, FieldGroup } from "@/ui/form-field"
import SectionHeading from "@/ui/section-heading"
import { MUTED_TEXT_CLASS_NAME, uiClassName } from "@/ui/ui-styles"

const REQUIRED_ANSWER_ERROR = "必須項目です。回答してください。"

const TEXT_ANSWER_LIMIT_LABEL = `${SURVEY_TEXT_ANSWER_MAX_GRAPHEMES.toLocaleString("ja-JP")}文字以内`

function getSurveyGuidance({ description, questions }: SurveyQuestionSet) {
  const evaluationQuestion = questions.find((item) => item.type === "likert7")
  const commentQuestion = questions.find((item) => item.type === "text")
  const beforeQuestion = new Map<string, string>()
  let introduction = ""

  // Relocate recognized guidance without dropping custom text or missing sections.
  for (const sentence of description.split(/(?<=。)/u)) {
    const text = sentence.trimStart()
    const target = text.startsWith("判断できない評価項目は")
      ? evaluationQuestion
      : text.startsWith("自由記述は") || text.startsWith("個人情報・")
        ? commentQuestion
        : undefined
    if (target) {
      beforeQuestion.set(
        target.id,
        (beforeQuestion.get(target.id) ?? "") + sentence,
      )
    } else {
      introduction += sentence
    }
  }

  return { introduction, beforeQuestion }
}

function getSurveyAnswerError(
  question: SurveyQuestion,
  answers: SurveyAnswer,
): string | null {
  if (question.type === "section") return null
  const answer = answers[question.id]
  if (question.required && (typeof answer !== "string" || answer.trim() === ""))
    return REQUIRED_ANSWER_ERROR
  if (
    question.type === "text" &&
    typeof answer === "string" &&
    countGraphemes(answer) > SURVEY_TEXT_ANSWER_MAX_GRAPHEMES
  )
    return `${TEXT_ANSWER_LIMIT_LABEL}で回答してください。`
  return null
}

function getSurveyItemClassName(item: SurveyQuestion) {
  switch (item.type) {
    case "single_choice":
      return "lg:col-span-1"
    case "section":
    case "likert7":
    case "text":
      return "lg:col-span-2"
  }
}

function getSurveyFailureMessage(reason: string) {
  switch (reason) {
    case "questionnaire_check_failed":
      return "質問票を確認できませんでした。アンケートは送信されていません。時間をおいて、もう一度お試しください。"
    case "questionnaire_changed":
      return "質問票が更新されたため送信できません。回答を確認のうえ、ページを再読み込みしてください。再送用の旧回答が残って再開できない場合は、研究者にご連絡ください。"
    case "session_busy":
      return SESSION_BUSY_MESSAGE
    case "survey_already_submitted":
      return "この解析のアンケートは送信済みです。再送信は不要です。ページを再読み込みして現在の状態を確認してください。"
    case "survey_submitted_state_write_failed":
      return "アンケートは送信されましたが、状態の更新に失敗しました。時間をおいて、もう一度お試しください。"
    case "survey_retry_storage_failed":
      return "再送用の回答をブラウザー内に保存できないため、送信していません。ブラウザーの保存領域と解析結果を確認してください。"
    case "analysis_mismatch":
      return "表示中の解析結果と現在の解析が一致しません。ページを再読み込みして結果を確認してください。アンケートは送信されていません。"
    default:
      return "アンケートの送信に失敗しました。時間をおいて、もう一度お試しください。"
  }
}

export default function SectionSurvey({
  initialSurveyQuestionSet,
  followUpSurveyQuestionSet,
}: {
  initialSurveyQuestionSet: SurveyQuestionSet
  followUpSurveyQuestionSet: SurveyQuestionSet
}) {
  const { isPreparingAnalysis, startNewAnalysis } = useStartNewAnalysis()
  const {
    completeSurveySubmission,
    returnToResult,
    updateSurveyAnswer,
    result,
    recoveredSurveyAnalysisId,
    recoveredSurveyPending,
    isRestoringResult,
    surveyAnswer,
    surveyDefinitionId,
    stage,
  } = useAppContext()
  const { updateStatusMessage } = useMessageContext()
  const isStageAllowed =
    stage === Stage.authenticated || stage === Stage.followUp

  const currentAnswers = result?.pendingSurveyAnswer ?? surveyAnswer

  const [submitting, setSubmitting] = useState(false)
  const [isReturningToResult, setIsReturningToResult] = useState(false)

  const submitInFlightRef = useRef(false)
  const [hasValidationAttempted, setHasValidationAttempted] = useState(false)
  const [validationFocus, setValidationFocus] = useState<{
    control: HTMLElement
  } | null>(null)
  const errorIdPrefix = useId()

  useEffect(() => {
    const control = validationFocus?.control
    if (!control?.isConnected) return
    control.focus({ preventScroll: true })
    const question = control.closest("[data-survey-question]") ?? control
    question.scrollIntoView({ block: "start", behavior: "instant" })
  }, [validationFocus])

  const surveyQuestionSet =
    stage === Stage.followUp
      ? followUpSurveyQuestionSet
      : initialSurveyQuestionSet
  const { questions: surveyQuestions } = surveyQuestionSet
  const { introduction, beforeQuestion } = getSurveyGuidance(surveyQuestionSet)

  const handleSurveyAnswerChange: ChangeEventHandler<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  > = (event) => {
    updateSurveyAnswer(
      event.target.name,
      event.target.value,
      surveyQuestionSet.definitionId,
    )
  }

  async function submitSurveyAndMoveToThanks() {
    const submissionResult = await completeSurveySubmission(
      currentAnswers,
      surveyQuestionSet.definitionId,
    )
    if (submissionResult.ok !== true) {
      if (submissionResult.reason === "superseded_operation") return
      const message = getSurveyFailureMessage(submissionResult.reason)
      updateStatusMessage(
        getSessionFailureStatus(submissionResult.reason) ?? {
          message,
          tone: "error",
        },
      )
      return
    }
    updateStatusMessage(
      submissionResult.localCleanupFailed === true
        ? {
            message:
              "アンケートの送信は完了しています。ブラウザー内に保存された回答の消去を完了できませんでした。消去ボタンから再試行してください。アンケートの再送信は不要です。",
            tone: "warning",
          }
        : null,
    )
  }

  async function handleMoveToResult() {
    setIsReturningToResult(true)
    try {
      const transitioned = await returnToResult()
      if (!transitioned.ok && transitioned.reason === "superseded_operation")
        return
      updateStatusMessage(
        transitioned.ok
          ? null
          : (getSessionFailureStatus(transitioned.reason) ?? {
              message:
                "結果表示に戻れませんでした。時間をおいて再度お試しください。",
              tone: "error",
            }),
      )
    } catch {
      updateStatusMessage({
        message: "結果表示に戻れませんでした。時間をおいて再度お試しください。",
        tone: "error",
      })
    } finally {
      setIsReturningToResult(false)
    }
  }

  function renderSurveyItem(item: SurveyQuestion) {
    const answerError = hasValidationAttempted
      ? getSurveyAnswerError(item, currentAnswers)
      : null
    const hasError = answerError !== null
    const errorId = `${errorIdPrefix}-${item.id}-error`
    const errorMessage = hasError ? (
      <FieldError id={errorId}>{answerError}</FieldError>
    ) : null
    switch (item.type) {
      case "section":
        return (
          <div
            key={item.id}
            className={uiClassName(
              "text-base font-semibold text-slate-900 dark:text-slate-50",
              getSurveyItemClassName(item),
              item !== surveyQuestions[0] &&
                "mt-2 border-t border-slate-300/80 pt-4 dark:border-white/15",
            )}
          >
            {item.text}
          </div>
        )
      case "single_choice":
        return (
          <FieldGroup
            key={item.id}
            data-survey-question={item.id}
            className={getSurveyItemClassName(item)}
          >
            <label htmlFor={item.id}>{item.text}</label>
            {errorMessage}
            <select
              id={item.id}
              name={item.id}
              value={currentAnswers[item.id] ?? ""}
              onChange={handleSurveyAnswerChange}
              required={item.required}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? errorId : undefined}
              className={`${CONTROL_CLASS_NAME} aria-invalid:border-red-500 dark:aria-invalid:border-red-400`}
            >
              <option value="">選択してください</option>
              {item.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </FieldGroup>
        )
      case "likert7":
        return (
          <LikertRadioFieldset
            key={item.id}
            className={getSurveyItemClassName(item)}
            name={item.id}
            legend={item.text}
            value={currentAnswers[item.id] ?? ""}
            onChange={handleSurveyAnswerChange}
            description={item.description}
            onClear={() =>
              updateSurveyAnswer(item.id, "", surveyQuestionSet.definitionId)
            }
            options={item.options}
            required={item.required}
            errorMessage={answerError ?? undefined}
          />
        )
      case "text":
        return (
          <FieldGroup
            key={item.id}
            data-survey-question={item.id}
            className={getSurveyItemClassName(item)}
          >
            <label htmlFor={item.id}>{item.text}</label>
            {errorMessage}
            <textarea
              id={item.id}
              name={item.id}
              value={currentAnswers[item.id] ?? ""}
              onChange={handleSurveyAnswerChange}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? errorId : `${errorId}-limit`}
              className={`min-h-30 ${CONTROL_CLASS_NAME} aria-invalid:border-red-500 dark:aria-invalid:border-red-400`}
              placeholder={item.placeholder}
              required={item.required}
            />
            <p id={`${errorId}-limit`} className={MUTED_TEXT_CLASS_NAME}>
              {TEXT_ANSWER_LIMIT_LABEL}
            </p>
          </FieldGroup>
        )
    }
  }

  const handleSubmitSurvey: SubmitEventHandler<HTMLFormElement> = async (
    event,
  ) => {
    event.preventDefault()
    if (submitInFlightRef.current) {
      return
    }
    setHasValidationAttempted(true)
    if (isRestoringResult || (result === null && !recoveredSurveyAnalysisId)) {
      updateStatusMessage({
        message: isRestoringResult
          ? "解析結果を読み込んでいます。しばらくお待ちください。"
          : "解析結果を確認できませんでした。「結果表示に戻る」から結果の再読み込みや書類の準備を行ってください。アンケートは送信されていません。",
        tone: isRestoringResult ? "info" : "error",
      })
      return
    }

    const firstInvalidQuestion = surveyQuestions.find(
      (question) => getSurveyAnswerError(question, currentAnswers) !== null,
    )
    if (firstInvalidQuestion) {
      const control = Array.from(event.currentTarget.elements).find(
        (element) => element.getAttribute("name") === firstInvalidQuestion.id,
      )
      if (control instanceof HTMLElement) {
        setValidationFocus({ control })
      }
      return
    }

    submitInFlightRef.current = true
    setSubmitting(true)
    try {
      await submitSurveyAndMoveToThanks()
    } catch {
      updateStatusMessage({
        message:
          "アンケートの送信結果を確認できませんでした。すでに受理されている可能性があります。通信状態を確認し、同じ回答で送信を再試行してください。",
        tone: "error",
      })
    } finally {
      submitInFlightRef.current = false
      setSubmitting(false)
    }
  }

  if (!isStageAllowed) {
    return <SessionStateRecovery />
  }

  if (result?.surveySubmitted) return <SectionThanks />
  const draftDefinitionId = result?.pendingQuestionnaireId ?? surveyDefinitionId
  if (
    (result?.pendingSurveyAnswer !== undefined &&
      draftDefinitionId === undefined) ||
    (draftDefinitionId !== undefined &&
      draftDefinitionId !== surveyQuestionSet.definitionId)
  )
    return (
      <CardSection>
        <p role="alert">{getSurveyFailureMessage("questionnaire_changed")}</p>
      </CardSection>
    )

  const isActionDisabled = submitting || isReturningToResult

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Survey"
        title="アンケートの回答と送信"
        description={introduction}
      />

      <form
        noValidate
        className="grid min-w-0 grid-cols-1 gap-5 border-t border-slate-200/80 pt-4 text-sm sm:rounded-xl sm:border sm:bg-slate-50/75 sm:p-6 lg:grid-cols-2 lg:gap-x-6 dark:border-white/10 dark:text-slate-200 sm:dark:bg-slate-950/30"
        onSubmit={(event) => void handleSubmitSurvey(event)}
      >
        {(result?.pendingSurveyAnswer || recoveredSurveyPending) && (
          <p className="lg:col-span-2" role="status">
            送信を試みた回答を保持しています。再送では同じ回答を使用するため、編集はできません。
          </p>
        )}
        <fieldset
          disabled={
            isRestoringResult ||
            submitting ||
            Boolean(result?.pendingSurveyAnswer || recoveredSurveyPending)
          }
          aria-busy={isRestoringResult}
          className="grid min-w-0 grid-cols-1 gap-5 lg:col-span-2 lg:grid-cols-2 lg:gap-x-6"
        >
          <legend className="sr-only">アンケートの回答</legend>
          {surveyQuestions.map((item) => (
            <Fragment key={item.id}>
              {beforeQuestion.has(item.id) && (
                <p
                  className={uiClassName(
                    MUTED_TEXT_CLASS_NAME,
                    "leading-7 lg:col-span-2",
                  )}
                >
                  {beforeQuestion.get(item.id)}
                </p>
              )}
              {renderSurveyItem(item)}
            </Fragment>
          ))}
        </fieldset>

        <div
          className={uiClassName(
            MUTED_TEXT_CLASS_NAME,
            "space-y-2 leading-relaxed lg:col-span-2",
          )}
        >
          <p>
            {recoveredSurveyAnalysisId
              ? "研究責任者が確認した初回解析に回答を関連付けます。解析結果の再生成は行いません。"
              : "送信後も解析結果を参照できます。ブラウザー内の一時データは、消去ボタンを押した時に消去されます。"}
          </p>
          <p>
            {stage === Stage.followUp
              ? "終了する場合は、ブラウザー内の一時データを消去してからブラウザーを閉じてください。未送信の回答は破棄されます。"
              : "アンケート送信後にブラウザー内の一時データを消去してからブラウザーを閉じてください。参加を取りやめる場合は、いつでも同意の撤回を行えます。"}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between lg:col-span-2">
          {!recoveredSurveyAnalysisId && (
            <ActionButton
              pending={isReturningToResult}
              pendingLabel="移動中..."
              variant="secondary"
              onClick={() => void handleMoveToResult()}
              disabled={isActionDisabled}
            >
              結果表示に戻る
            </ActionButton>
          )}
          <ActionButton
            type="submit"
            disabled={isActionDisabled || isRestoringResult}
          >
            {isRestoringResult
              ? "結果を読み込み中..."
              : submitting
                ? "送信中..."
                : "アンケートを送信"}
          </ActionButton>
        </div>
      </form>
      {stage === Stage.followUp && (
        <ActionButton
          className="sm:self-start"
          variant="secondary"
          pending={isPreparingAnalysis}
          disabled={
            submitting ||
            Boolean(result?.pendingSurveyAnswer || recoveredSurveyPending)
          }
          onClick={() => void startNewAnalysis()}
        >
          ブラウザー内の一時データを消去する
        </ActionButton>
      )}
    </CardSection>
  )
}
