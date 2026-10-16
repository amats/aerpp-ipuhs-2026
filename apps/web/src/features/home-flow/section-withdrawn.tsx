"use client"

import { useAppContext } from "@/features/app-context/app-context-provider"
import { Stage } from "@/features/app-context/stage-types"
import WithdrawalCleanupPanel from "@/features/withdraw/withdrawal-cleanup-panel"
import WithdrawalRecoveryNotice from "@/features/withdraw/withdrawal-recovery-notice"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

export default function SectionWithdrawn({
  contactEmail,
}: {
  contactEmail: string
}) {
  const { stage } = useAppContext()

  if (stage !== Stage.withdrawn) {
    return null
  }

  return (
    <CardSection>
      <SectionHeading
        eyebrow="Withdrawn"
        title="研究参加の撤回を受け付けました"
        description="研究への参加は終了しています。データの消去状況は、以下の表示をご確認ください。"
      />
      <WithdrawalCleanupPanel autoRefresh />
      <WithdrawalRecoveryNotice contactEmail={contactEmail} />
    </CardSection>
  )
}
