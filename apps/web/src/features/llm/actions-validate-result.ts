"use server"

import { withSessionRead } from "@/features/session/session-operation"
import { getSession } from "@/lib/session"

export async function validateResultAction(analysisId: string, token?: string) {
  return withSessionRead(token, async () => {
    const session = await getSession()
    if (
      session.lastCompletedAnalysisId !== analysisId ||
      session.presentedAnalysisId !== analysisId
    )
      return { ok: false as const, reason: "analysis_mismatch" }
    return { ok: true as const }
  })
}
