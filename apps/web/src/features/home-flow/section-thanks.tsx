"use client"
import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import SessionStateRecovery from "@/features/session/session-state-recovery"
import ActionButton from "@/ui/action-button"
import AlertMessage from "@/ui/alert-message"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"
import { ACTION_ROW_CLASS_NAME, BODY_TEXT_CLASS_NAME } from "@/ui/ui-styles"
import { useIntroNavigation } from "./use-intro-navigation"
import { useStartNewAnalysis } from "./use-start-new-analysis"
import { useStoredAnalysisPresence } from "./use-stored-analysis-presence"

export default function SectionThanks() {
  const {
    result,
    documentDraft,
    resultRestorationFailed,
    isRestoringResult,
    stage,
    returnToResult,
  } = useAppContext()
  const isStageAllowed = stage === Stage.followUp

  const { isPreparingAnalysis, startNewAnalysis } = useStartNewAnalysis()
  const storedPresence = useStoredAnalysisPresence()
  const needsCleanup =
    result !== null ||
    Object.values(documentDraft.documents).some((text) => text.length > 0) ||
    Object.keys(documentDraft.sourceFileNames).length > 0 ||
    storedPresence.analysisResult !== "absent" ||
    storedPresence.recoveredSurvey !== "absent"
  const returnNavigation = useIntroNavigation({
    moveNext: returnToResult,
    failureMessage:
      "結果表示に戻れませんでした。時間をおいて再度お試しください。",
  })

  if (!isStageAllowed) {
    return <SessionStateRecovery />
  }

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Complete"
        title="ご協力ありがとうございました"
        description={
          result
            ? "アンケートへのご回答と研究へのご協力に心より感謝いたします。ブラウザー内の文書・結果・回答は、下の消去ボタンを押すまで保持されます。消去後は文書登録画面に戻ります。"
            : needsCleanup
              ? "アンケートの送信は完了しています。ブラウザー内に残っている文書・結果・回答を消去してから、書類の準備へ進めます。"
              : "アンケートの送信が完了しました。ここで終了するか、書類の準備へ進んで引き続きご利用いただけます。"
        }
      />
      {resultRestorationFailed && (
        <AlertMessage tone="warning">
          アンケートの送信は完了しています。
          ブラウザー内の解析結果を読み込めませんでした。
          アンケートの再送信は不要です。
        </AlertMessage>
      )}
      {needsCleanup && (
        <p className={BODY_TEXT_CLASS_NAME}>
          終了する場合は、ブラウザー内の一時データを消去してからブラウザーを閉じてください。
          ブラウザーを閉じるだけでは暗号化した結果や回答が残ることがあります。
          元のファイルやダウンロード済みのファイル、送信済みアンケートは消去ボタンの対象外です。
        </p>
      )}
      <div className={ACTION_ROW_CLASS_NAME}>
        {result !== null && (
          <ActionButton
            className="sm:mr-auto"
            variant="secondary"
            pending={returnNavigation.isMovingNext}
            pendingLabel="移動中..."
            onClick={() => void returnNavigation.handleMoveToNext()}
          >
            結果表示に戻る
          </ActionButton>
        )}
        <ActionButton
          disabled={isRestoringResult}
          pending={isPreparingAnalysis}
          pendingLabel="準備中..."
          onClick={() => void startNewAnalysis()}
        >
          {needsCleanup
            ? "ブラウザー内の一時データを消去する"
            : "書類の準備へ進む"}
        </ActionButton>
      </div>
    </CardSection>
  )
}
