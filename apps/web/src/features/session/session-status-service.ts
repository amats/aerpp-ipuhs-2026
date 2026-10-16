import "server-only"

import { readStepStateFromSession } from "@/features/app-context/step-state-session"
import { getSessionForTab } from "@/lib/session"
import { readAuthority } from "@/lib/session-authority"
import type { SessionStatus } from "./session-status-types"

export async function readSessionStatus(
  token: string,
): Promise<SessionStatus | null> {
  const session = await getSessionForTab(token)
  const id = session.coordinationId
  if (!id) return null
  const current = readAuthority(id)
  if (!current) return null
  return {
    admitted: true,
    analysisId: session.lastCompletedAnalysisId ?? null,
    submitted: session.submittedAnalysisId ?? null,
    withdrawing: current.withdrawing === 1,
    stepState: await readStepStateFromSession(session),
  }
}
