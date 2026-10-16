import { env } from "@aerpp/config/server/web"
import { notFound } from "next/navigation"
import DebugHomeFlowPanel from "@/features/debug/debug-home-flow-panel"
import DebugRefreshButton from "@/features/debug/debug-refresh-button"
import CardSection from "@/ui/card-section"
import SectionHeading from "@/ui/section-heading"

export default function DebugHomeFlowPage() {
  if (env.debugPagesEnabled !== true) notFound()
  return (
    <CardSection className="gap-5">
      <SectionHeading
        eyebrow="Debug"
        title="Home flow debug snapshot"
        description="AppContext の home-flow state と関連する保存値を確認するためのページです。"
      />
      <DebugRefreshButton />
      <DebugHomeFlowPanel />
    </CardSection>
  )
}
