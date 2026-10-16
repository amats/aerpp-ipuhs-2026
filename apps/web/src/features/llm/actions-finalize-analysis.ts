"use server"

import {
  isLocallyAuthenticated,
  readLocalAuthenticationFromSession,
} from "@/features/auth/auth-session"
import type { AnalysisCompletionMetadata } from "@/features/llm/analysis-completion-types"
import { unsealAnalysisCompletionReceipt } from "@/features/llm/analysis-receipt"
import { readActiveAnalysisIdFromSession } from "@/features/llm/analysis-session"
import { withSessionOperation } from "@/features/session/session-operation"
import { recordAnalysisCompletion as recordAnalysisCompletionService } from "@/features/survey/survey-service"
import { BROWSER_PAYLOAD_CONSTRAINTS as limits } from "@/lib/browser-payload-constraints.mjs"
import { createLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { type AppSession, getSession } from "@/lib/session"

export type FinalizeAnalysisResult =
  | { ok: true; metadata: AnalysisCompletionMetadata }
  | { ok: false; reason: string }

async function finalizeAnalysis(
  sealedReceipt: unknown,
): Promise<FinalizeAnalysisResult> {
  const logger = createLogger({
    component: "survey",
    operation: "submit_metadata_action",
  })
  let session: AppSession
  try {
    session = await getSession()
  } catch (error) {
    logger.error({
      event: LOG_EVENT.sessionGetFailed,
      error,
      operation: "record_analysis_completion",
    })
    return { ok: false, reason: "finalize_failed" }
  }

  try {
    if (
      typeof sealedReceipt !== "string" ||
      sealedReceipt === "" ||
      sealedReceipt.length > limits.maxSealedCharacters
    ) {
      return { ok: false, reason: "finalize_failed" }
    }

    const authentication = await readLocalAuthenticationFromSession(session)
    const receipt = await unsealAnalysisCompletionReceipt(sealedReceipt)
    if (
      !receipt ||
      isLocallyAuthenticated(authentication) !== true ||
      receipt.ownerClientId !== authentication.clientId ||
      receipt.ownerPseudonym !== authentication.pseudonym
    ) {
      return { ok: false, reason: "finalize_failed" }
    }

    const metadata: AnalysisCompletionMetadata = {
      analysisId: receipt.analysisId,
      analysisWorkspaceVersion: receipt.analysisWorkspaceVersion,
      documentCount: receipt.documentCount,
      documentGraphemeCount: receipt.documentGraphemeCount,
      modelName: receipt.modelName,
      processingDurationSeconds: receipt.processingDurationSeconds,
      resultGraphemeCount: receipt.resultGraphemeCount,
    }
    const activeAnalysisId = readActiveAnalysisIdFromSession(session)
    if (
      activeAnalysisId === null &&
      session.lastCompletedAnalysisId === receipt.analysisId
    ) {
      return { ok: true, metadata }
    }
    if (
      activeAnalysisId !== receipt.analysisId ||
      session.lastCompletedAnalysisId === receipt.analysisId
    ) {
      return { ok: false, reason: "finalize_failed" }
    }
    const submitted = await recordAnalysisCompletionService(session, metadata)
    if (submitted !== true) {
      return { ok: false, reason: "finalize_failed" }
    }

    delete session.activeAnalysisId
    session.lastCompletedAnalysisId = receipt.analysisId
    try {
      await session.save()
    } catch (error) {
      logger.error({
        error,
        event: LOG_EVENT.sessionWriteFailed,
        operation: "record_analysis_completion",
        rootStep: session.rootStep,
        stage: session.stage,
      })
      return { ok: false, reason: "finalize_failed" }
    }
    return { ok: true, metadata }
  } catch (error) {
    logger.error({
      event: LOG_EVENT.analysisCompletionRecordFailed,
      error,
      operation: "record_analysis_completion",
    })
    return { ok: false, reason: "finalize_failed" }
  }
}

export async function finalizeAnalysisAction(
  sealedReceipt: unknown,
  token?: string,
): Promise<FinalizeAnalysisResult> {
  return withSessionOperation(token, "ordinary", () =>
    finalizeAnalysis(sealedReceipt),
  )
}
