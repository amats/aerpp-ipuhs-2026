"use client"
import Welcome from "@/assets/welcome.mdx"
import { useAppContext } from "@/features/app-context/app-context-provider"
import ActionButton from "@/ui/action-button"
import CardSection from "@/ui/card-section"
import RichTextBlock from "@/ui/rich-text-block"
import SectionHeading from "@/ui/section-heading"
import { ACTION_ROW_CLASS_NAME } from "@/ui/ui-styles"
import { useIntroNavigation } from "./use-intro-navigation"

export default function SectionStart() {
  const { moveToExplanation } = useAppContext()
  const { isMovingNext, handleMoveToNext } = useIntroNavigation({
    moveNext: moveToExplanation,
    failureMessage:
      "説明画面に進めませんでした。時間をおいて再度お試しください。",
  })

  return (
    <CardSection>
      <SectionHeading eyebrow="Overview" title="このシステムについて" />
      <RichTextBlock>
        <Welcome />
      </RichTextBlock>
      <div className={ACTION_ROW_CLASS_NAME}>
        <ActionButton
          pending={isMovingNext}
          pendingLabel="移動中..."
          onClick={() => void handleMoveToNext()}
        >
          次に進む
        </ActionButton>
      </div>
    </CardSection>
  )
}
