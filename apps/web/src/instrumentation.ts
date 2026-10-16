import { PHASE_PRODUCTION_BUILD } from "next/constants"

export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
  )
    return
  const { startAnalysisAuditDelivery } = await import(
    "./features/llm/analysis-audit-delivery"
  )
  startAnalysisAuditDelivery()
}
