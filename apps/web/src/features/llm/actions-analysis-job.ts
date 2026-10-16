"use server"

import { withSessionOperation } from "@/features/session/session-operation"
import { createLogger } from "@/lib/logger"
import { readAnalysisJobAccess } from "./analysis-job-access"
import {
  readMemoryAnalysisJob,
  readMemoryAnalysisRetry,
  retryMemoryAnalysisRecording,
} from "./analysis-job-registry"
import { acceptAnalysisJob } from "./analysis-job-service"
import { analysisIdSchema } from "./analysis-receipt-types"

export async function retryAnalysisJobRecordingAction(
  analysisId: unknown,
  token?: string,
) {
  const id = analysisIdSchema.safeParse(analysisId)
  if (id.success !== true)
    return { ok: false as const, reason: "analysis_mismatch" }
  return withSessionOperation(token, "ordinary", async () => {
    const { owner, analysisId: current } = await readAnalysisJobAccess(token)
    if (current !== id.data)
      return { ok: false as const, reason: "analysis_mismatch" }
    if (!readMemoryAnalysisJob(id.data, owner))
      return { ok: false as const, reason: "result_unavailable" }
    return (await retryMemoryAnalysisRecording(id.data, owner)) === true
      ? { ok: true as const }
      : { ok: false as const, reason: "completion_failed" }
  })
}

export async function retryAnalysisAction(analysisId: unknown, token?: string) {
  const id = analysisIdSchema.safeParse(analysisId)
  if (id.success !== true)
    return { ok: false as const, reason: "analysis_mismatch" }
  return withSessionOperation(token, "ordinary", async () => {
    const {
      session,
      owner,
      analysisId: current,
    } = await readAnalysisJobAccess(token)
    if (current !== id.data || session.lastCompletedAnalysisId)
      return { ok: false as const, reason: "analysis_mismatch" }
    const input = readMemoryAnalysisRetry(id.data, owner)
    if (!input) return { ok: false as const, reason: "retry_unavailable" }
    return acceptAnalysisJob({
      session,
      input,
      expectedFailedId: id.data,
      logger: createLogger({ component: "llm", operation: "analysis_retry" }),
    })
  })
}
