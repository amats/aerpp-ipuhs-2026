"use client"
import Explanation from "@/assets/explanation.mdx"
import { useAppContext } from "@/features/app-context/app-context-provider"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import RichTextBlock from "@/ui/rich-text-block"
import SectionHeading from "@/ui/section-heading"
import { ACTION_ROW_CLASS_NAME } from "@/ui/ui-styles"
import { useIntroNavigation } from "./use-intro-navigation"

export default function SectionExplanation() {
  const { moveToConsent, moveToOverview } = useAppContext()
  const { isMovingNext, handleMoveToNext } = useIntroNavigation({
    moveNext: moveToConsent,
    failureMessage:
      "同意画面に進めませんでした。時間をおいて再度お試しください。",
  })
  const previous = useIntroNavigation({
    moveNext: moveToOverview,
    failureMessage:
      "概要画面に戻れませんでした。時間をおいて再度お試しください。",
  })

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Explanation"
        title="研究へのご参加について（研究の説明）"
      />
      <RichTextBlock>
        <Explanation />
      </RichTextBlock>
      <div className={ACTION_ROW_CLASS_NAME}>
        <ActionButton
          className="sm:mr-auto"
          variant="secondary"
          pending={previous.isMovingNext}
          onClick={() => void previous.handleMoveToNext()}
        >
          概要に戻る
        </ActionButton>
        <ActionButton
          pending={isMovingNext}
          pendingLabel="移動中..."
          onClick={() => void handleMoveToNext()}
        >
          同意画面へ進む
        </ActionButton>
      </div>
    </CardSection>
  )
}
