"use client"

import { useState } from "react"
import MarkDown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import { validateResultAction } from "@/features/llm/actions-validate-result"
import AnalysisProgress from "@/features/llm/analysis-progress"
import { remarkImagesToText } from "@/features/llm/remark-images-to-text"
import { remarkResultWhitespace } from "@/features/llm/remark-result-whitespace"
import { useAnalysisJob } from "@/features/llm/use-analysis-job"
import { useMessageContext } from "@/features/message/message-context-provider"
import { getSessionFailureStatus } from "@/features/session/session-recovery"
import SessionStateRecovery from "@/features/session/session-state-recovery"
import { countGraphemes } from "@/lib/graphemes"
import { runSessionMutation } from "@/lib/session-mutation"
import { getTabToken } from "@/lib/tab-token"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import {
  MUTED_TEXT_CLASS_NAME,
  SURFACE_PANEL_CLASS_NAME,
  uiClassName,
} from "@/ui/ui-styles"
import { useStartNewAnalysis } from "./use-start-new-analysis"

const RESULT_MARKDOWN_COMPONENTS: Components = {
  table: ({ children }) => (
    <section
      aria-label="解析結果の表"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll wide result tables.
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue)"
    >
      <table>{children}</table>
    </section>
  ),
  pre: ({ children }) => (
    <section
      aria-label="解析結果のコード"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll preformatted result text.
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--brand-blue)"
    >
      <pre className="min-w-max overflow-visible">{children}</pre>
    </section>
  ),
}

export default function SectionResult() {
  const { startSurvey, result, isRestoringResult, stage, analysisStatus } =
    useAppContext()
  const { updateStatusMessage } = useMessageContext()
  const isStageAllowed =
    stage === Stage.authenticated || stage === Stage.followUp

  const [isSavingWord, setIsSavingWord] = useState(false)
  const [isMovingToSurvey, setIsMovingToSurvey] = useState(false)
  const { isPreparingAnalysis, startNewAnalysis } = useStartNewAnalysis()
  const {
    resultText,
    hasPendingCompletion,
    hasPendingTermination,
    hasCompletedResult,
    hasFailedAnalysis,
    failedAnalysis,
    isAnalysisRunning,
    isWaitingForResult,
    isRecoveringAnalysis,
    isFinalizing,
    retryCompletion,
    recoverFailedAnalysis,
    elapsedTime,
    jobStatus,
    connectionLost,
    retryConnection,
    retryAnalysis,
    canRetryAnalysis,
    stopAnalysis,
    isCancelling,
  } = useAnalysisJob()
  const resultGraphemeCount = countGraphemes(resultText)

  async function handleSaveAsWord() {
    setIsSavingWord(true)
    try {
      if (!result) return
      const checked = await runSessionMutation(() =>
        validateResultAction(result.analysisId, getTabToken()),
      )
      if (checked.ok !== true) {
        if (checked.reason === "superseded_operation") return
        updateStatusMessage(
          getSessionFailureStatus(checked.reason) ?? {
            message:
              "解析結果を確認できませんでした。時間をおいて、保存を再試行してください。",
            tone: "error",
          },
        )
        return
      }
      const { downloadAnalysisResultAsWord } = await import(
        "@/features/llm/export-analysis-result"
      )
      await downloadAnalysisResultAsWord(resultText)
    } catch {
      updateStatusMessage({
        message:
          "解析結果の保存ファイルを作成できませんでした。時間をおいて再度お試しください。",
        tone: "error",
      })
    } finally {
      setIsSavingWord(false)
    }
  }

  async function handleMoveToSurvey() {
    const failureMessage =
      "アンケートへ進めませんでした。時間をおいて、もう一度お試しください。"
    setIsMovingToSurvey(true)
    try {
      const transitionResult = await startSurvey()
      if (transitionResult.ok !== true) {
        if (transitionResult.reason === "superseded_operation") return
        updateStatusMessage(
          getSessionFailureStatus(transitionResult.reason) ?? {
            message:
              transitionResult.reason === "no_result"
                ? "解析結果を確認できませんでした。ページを再読み込みして現在の状態を確認してください。"
                : failureMessage,
            tone: "error",
          },
        )
      } else {
        updateStatusMessage(null)
      }
    } catch {
      updateStatusMessage({
        message: failureMessage,
        tone: "error",
      })
    } finally {
      setIsMovingToSurvey(false)
    }
  }

  if (!isStageAllowed) {
    return <SessionStateRecovery />
  }

  const saveButton = (
    <ActionButton
      pending={isSavingWord}
      pendingLabel="保存ファイルを作成中..."
      variant="secondary"
      onClick={() => void handleSaveAsWord()}
      disabled={resultGraphemeCount === 0}
    >
      Word形式で保存
    </ActionButton>
  )

  return (
    <CardSection>
      <SectionHeading eyebrow="Results" title="解析結果" />

      {hasPendingTermination && !hasCompletedResult && (
        <div
          className={uiClassName(
            SURFACE_PANEL_CLASS_NAME,
            "grid gap-3 p-3 sm:p-5",
          )}
        >
          <p role="status">
            解析は終了しています。終了記録を再試行してください。
          </p>
          <p className={MUTED_TEXT_CLASS_NAME}>
            同じ解析の終了記録だけを再送します。解析はやり直しません。
          </p>
          <ActionButton
            pending={isFinalizing}
            pendingLabel="終了記録を確認中..."
            onClick={() => void retryCompletion()}
          >
            終了記録を再試行
          </ActionButton>
        </div>
      )}

      {hasPendingCompletion && !hasCompletedResult && (
        <div
          className={uiClassName(
            SURFACE_PANEL_CLASS_NAME,
            "grid gap-3 p-3 sm:p-5",
          )}
        >
          {isFinalizing ? (
            <AnalysisProgress
              elapsedTime={elapsedTime}
              label="解析結果の保存・提示記録を確認しています。"
            />
          ) : (
            <p role="status">
              解析結果を保持しています。完了処理を再試行してください。
            </p>
          )}
          <p className={MUTED_TEXT_CLASS_NAME}>
            完了処理を再試行しても、解析はやり直しません。
            サーバーのメモリーに保持している結果は、期限内であれば再取得できます。
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              pending={isFinalizing}
              pendingLabel="完了処理中..."
              onClick={() => void retryCompletion()}
            >
              完了処理を再試行
            </ActionButton>
            {saveButton}
          </div>
        </div>
      )}

      {hasFailedAnalysis && !hasCompletedResult && (
        <div
          className={uiClassName(
            SURFACE_PANEL_CLASS_NAME,
            "grid gap-3 p-3 sm:p-5",
          )}
        >
          <p role="status">
            解析は停止しています。入力した書類を保持したまま再度試す場合は、書類の準備に戻ってください。別のタブで解析した場合は、ページを再読み込みして現在の結果を確認できます。再読み込みすると、このタブで入力した書類は失われます。
          </p>
          {canRetryAnalysis && (
            <p className={MUTED_TEXT_CLASS_NAME}>
              保持している同じプロンプトで再解析できます。解析を再試行すると、LLMをもう一度呼び出します。
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {canRetryAnalysis && (
              <ActionButton
                pending={isRecoveringAnalysis}
                pendingLabel="再解析を開始中..."
                onClick={() => void retryAnalysis()}
              >
                解析を再試行
              </ActionButton>
            )}
            <ActionButton
              variant="secondary"
              disabled={isRecoveringAnalysis}
              onClick={() => window.location.reload()}
            >
              ページを再読み込み
            </ActionButton>
            <ActionButton
              pending={isRecoveringAnalysis}
              pendingLabel="移動中..."
              onClick={() =>
                void recoverFailedAnalysis(
                  failedAnalysis?.message ?? "解析中にエラーが発生しました。",
                )
              }
            >
              書類の準備へ戻る
            </ActionButton>
          </div>
        </div>
      )}

      {connectionLost && !hasCompletedResult && !hasPendingCompletion && (
        <div
          className={uiClassName(
            SURFACE_PANEL_CLASS_NAME,
            "grid gap-3 p-3 sm:p-5",
          )}
        >
          {isRecoveringAnalysis ? (
            <AnalysisProgress
              elapsedTime={null}
              label="書類の準備への復帰を確認しています。"
            />
          ) : (
            <p role="status">
              {jobStatus === "unavailable"
                ? "解析は終了していますが、結果を取得できません。"
                : "解析の通信状況を確認できません。解析が続いている可能性があります。"}
            </p>
          )}
          <p className={MUTED_TEXT_CLASS_NAME}>
            接続を再確認しても、解析はやり直しません。結果の保持期限を過ぎた場合やサーバーが再起動した場合は、結果を取得できないことがあります。
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              disabled={isRecoveringAnalysis}
              onClick={retryConnection}
            >
              接続を再確認
            </ActionButton>
            <ActionButton
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              ページを再読み込み
            </ActionButton>
            {jobStatus === "idle" && (
              <ActionButton
                variant="secondary"
                pending={isRecoveringAnalysis}
                pendingLabel="移動中..."
                onClick={() =>
                  void recoverFailedAnalysis("書類の準備に戻りました。")
                }
              >
                書類の準備へ戻る
              </ActionButton>
            )}
            {stage === Stage.followUp &&
              analysisStatus === "completed" &&
              jobStatus === "unavailable" && (
                <ActionButton
                  variant="secondary"
                  disabled={isRecoveringAnalysis}
                  pending={isPreparingAnalysis}
                  pendingLabel="準備中..."
                  onClick={() => void startNewAnalysis()}
                >
                  書類の準備へ戻る
                </ActionButton>
              )}
          </div>
        </div>
      )}

      {!connectionLost &&
        !isAnalysisRunning &&
        !hasCompletedResult &&
        !hasFailedAnalysis &&
        !hasPendingTermination &&
        !hasPendingCompletion && (
          <div
            className={uiClassName(
              SURFACE_PANEL_CLASS_NAME,
              "grid gap-3 p-3 sm:p-5",
            )}
          >
            <p role="status">
              {isRestoringResult
                ? "保存した解析結果を読み込んでいます..."
                : analysisStatus === "running"
                  ? "解析中です。完了後にページを再読み込みすると結果を表示します。このタブから別の解析は開始できません。"
                  : "解析結果を表示できません。ページを再読み込みしてください。初回の結果を失った場合は、再解析せず研究者にご連絡ください。"}
            </p>
            {!isRestoringResult && (
              <div className="flex flex-wrap gap-3">
                <ActionButton
                  variant="secondary"
                  onClick={() => window.location.reload()}
                  disabled={isPreparingAnalysis}
                >
                  ページを再読み込み
                </ActionButton>
                {stage === Stage.followUp && analysisStatus !== "running" && (
                  <ActionButton
                    pending={isPreparingAnalysis}
                    pendingLabel="準備中..."
                    onClick={() => void startNewAnalysis()}
                  >
                    書類の準備へ戻る
                  </ActionButton>
                )}
              </div>
            )}
          </div>
        )}

      {(isAnalysisRunning || hasCompletedResult) && (
        <div
          className={uiClassName(
            SURFACE_PANEL_CLASS_NAME,
            "flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-5",
          )}
        >
          <div className="flex min-w-0 flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            {hasCompletedResult ? (
              <p role="status" className="font-semibold">
                解析が終了しました。
              </p>
            ) : (
              <AnalysisProgress
                elapsedTime={elapsedTime}
                label={
                  isWaitingForResult
                    ? "解析中です..."
                    : "解析結果の終了記録を確認しています..."
                }
              />
            )}
            {isAnalysisRunning ? (
              <p>
                {isWaitingForResult
                  ? "解析終了を待っています。"
                  : "サーバーからの応答を受け取り、終了記録を確認しています。"}
                完了した結果は、ブラウザーへの保存を確認するまでサーバーのメモリーに最長10分間保持します。
              </p>
            ) : (
              <>
                <p>
                  解析結果はこのブラウザーに暗号化して保存しています。
                  サーバーには永続保存しません。
                </p>
                <p>必要に応じてWord形式で保存できます。</p>
              </>
            )}
          </div>
          {isAnalysisRunning && (
            <ActionButton
              variant="secondary"
              pending={isCancelling}
              pendingLabel="中止を確認中..."
              onClick={() => void stopAnalysis()}
            >
              解析を中止する
            </ActionButton>
          )}
          {hasCompletedResult && saveButton}
        </div>
      )}

      <div className="rounded-2xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-bold">
          この結果をそのまま申請に用いないでください。
        </p>
        <p className="mt-1 leading-6">
          解析結果には、誤りや不適切な表現が含まれる場合があります。
          実際の倫理申請では、申請者ご自身の責任で内容を確認し、必要に応じて修正したうえでご利用ください。
        </p>
      </div>

      {resultText && (
        <div
          className={uiClassName(
            SURFACE_PANEL_CLASS_NAME,
            "min-w-0 bg-white/80 p-3 sm:p-6",
          )}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none wrap-break-word text-slate-800 dark:text-slate-100">
            <MarkDown
              remarkPlugins={[
                remarkGfm,
                remarkImagesToText,
                remarkResultWhitespace,
              ]}
              components={RESULT_MARKDOWN_COMPONENTS}
            >
              {resultText}
            </MarkDown>
          </div>
        </div>
      )}

      {hasCompletedResult && (
        <div
          className={uiClassName(
            SURFACE_PANEL_CLASS_NAME,
            "flex flex-col gap-4 p-3 sm:p-6",
          )}
        >
          {result?.surveySubmitted === true ? (
            <p role="status">
              この解析のアンケートは送信済みです。再回答は不要です。
            </p>
          ) : (
            <>
              <p className={MUTED_TEXT_CLASS_NAME}>
                結果をご確認のうえ、アンケートへのご協力をお願いいたします。
              </p>
              <p className={MUTED_TEXT_CLASS_NAME}>
                アンケートから結果表示に戻れます。画面を行き来しても、入力中の回答は保持されます。
              </p>
            </>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {stage === Stage.followUp && (
              <ActionButton
                pending={isPreparingAnalysis}
                pendingLabel="準備中..."
                variant="secondary"
                className="sm:mr-auto"
                onClick={() => void startNewAnalysis()}
              >
                ブラウザー内の一時データを消去する
              </ActionButton>
            )}
            {saveButton}
            {!result?.surveySubmitted && (
              <ActionButton
                pending={isMovingToSurvey}
                pendingLabel="移動中..."
                onClick={() => void handleMoveToSurvey()}
              >
                アンケートを開く
              </ActionButton>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className={MUTED_TEXT_CLASS_NAME}>
              {stage === Stage.followUp
                ? "「ブラウザー内の一時データを消去する」を押すと、ブラウザー内の文書・解析結果・回答を消去し、文書登録画面に戻ります。"
                : "初回はアンケート送信後に「ブラウザー内の一時データを消去する」が使えます。消去すると、文書登録画面に戻ります。"}
            </p>
            <p className={MUTED_TEXT_CLASS_NAME}>
              終了時は、必要な結果をWord形式で保存し、ブラウザー内の一時データを消去してからブラウザーを閉じてください。
              元のファイル、ダウンロード済みのファイル、送信済みのアンケートは消去されません。
            </p>
            {stage !== Stage.followUp && (
              <p className={MUTED_TEXT_CLASS_NAME}>
                参加を取りやめる場合は、いつでも同意の撤回を行えます。
              </p>
            )}
          </div>
        </div>
      )}
    </CardSection>
  )
}
