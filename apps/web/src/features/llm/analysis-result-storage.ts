"use client"

import {
  type AnalysisResult,
  type AnalysisResultReadOutcome,
  type AnalysisResultWriteOutcome,
  analysisResultSchema,
  type SurveyPreparationOutcome,
} from "@/features/app-context/analysis-result-types"
import {
  sealAnalysisResultAction,
  sealSurveyResultAction,
  unsealAnalysisResultAction,
} from "@/features/llm/actions-analysis-result-seal"
import type { SurveyAnswer } from "@/features/survey/survey-answer-types"
import {
  isBrowserPayloadCurrent,
  readBrowserPayload,
  replaceBrowserPayload,
} from "@/lib/browser-session"
import { awaitTabResponse, isTabOperationCurrent } from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"

let storageGeneration = 0
export function invalidateAnalysisResultStorageOperations() {
  storageGeneration += 1
}

export async function saveAnalysisResultInBrowser(
  result: AnalysisResult | null,
  signal?: AbortSignal,
): Promise<AnalysisResultWriteOutcome> {
  try {
    if (signal?.aborted || isTabOperationCurrent() !== true)
      return { ok: false, reason: "cancelled" }
    const generation = storageGeneration
    const snapshot = await readBrowserPayload("analysisResult")
    if (result === null || result.text.trim() === "") {
      invalidateAnalysisResultStorageOperations()
      return (await replaceBrowserPayload("analysisResult", snapshot, null)) ===
        true
        ? { ok: true }
        : { ok: false, reason: "storage_changed" }
    }
    if (snapshot.value !== null) {
      const stored = await awaitTabResponse(
        unsealAnalysisResultAction(snapshot.value, getTabToken()),
      )
      if (stored.ok !== true) return { ok: false, reason: "write_failed" }
      const parsed = analysisResultSchema.safeParse(stored.result)
      if (stored.result !== null && parsed.success !== true)
        return { ok: false, reason: "write_failed" }
      // A completion retry cannot replace questionnaire progress that predates
      // this snapshot. Reload restores it through the existing read boundary.
      if (
        stored.surveySubmitted === true ||
        (parsed.success === true &&
          (parsed.data.analysisId !== result.analysisId ||
            parsed.data.pendingSurveyAnswer !== undefined ||
            parsed.data.surveySubmitted === true))
      )
        return { ok: false, reason: "storage_changed" }
    }
    if (
      signal?.aborted ||
      generation !== storageGeneration ||
      isTabOperationCurrent() !== true
    )
      return { ok: false, reason: "cancelled" }
    const encrypted = await awaitTabResponse(
      sealAnalysisResultAction(result, getTabToken()),
    ).catch(() => null)
    if (
      signal?.aborted ||
      generation !== storageGeneration ||
      isTabOperationCurrent() !== true
    )
      return { ok: false, reason: "cancelled" }
    if ((await isBrowserPayloadCurrent("analysisResult", snapshot)) !== true)
      return { ok: false, reason: "storage_changed" }
    if (encrypted === null) return { ok: false, reason: "write_failed" }
    return (await replaceBrowserPayload(
      "analysisResult",
      snapshot,
      encrypted,
    )) === true
      ? { ok: true }
      : { ok: false, reason: "storage_changed" }
  } catch {
    return { ok: false, reason: "write_failed" }
  }
}

export async function readAnalysisResultFromBrowser(): Promise<AnalysisResultReadOutcome> {
  try {
    const generation = storageGeneration
    const snapshot = await readBrowserPayload("analysisResult")
    if (snapshot.value === null) return { ok: true, result: null }
    const decrypted = await awaitTabResponse(
      unsealAnalysisResultAction(snapshot.value, getTabToken()),
    )
    if (
      isTabOperationCurrent() !== true ||
      generation !== storageGeneration ||
      (await isBrowserPayloadCurrent("analysisResult", snapshot)) !== true
    )
      return { ok: false }
    if (decrypted.ok !== true) return decrypted
    const parsed = analysisResultSchema.safeParse(decrypted.result)
    if (decrypted.result === null || parsed.success !== true) {
      // A failed or stale read never deletes a replacement written by another tab.
      return (await replaceBrowserPayload("analysisResult", snapshot, null)) ===
        true
        ? { ok: true, result: null }
        : { ok: false }
    }
    return {
      ok: true,
      result: {
        ...parsed.data,
        ...(decrypted.surveySubmitted === true
          ? { surveySubmitted: true }
          : {}),
      },
    }
  } catch {
    return { ok: false }
  }
}

// Sealing is outside the transaction. Generation/version comparison and replacing
// the complete frozen payload commit together before any survey can be sent.
export async function prepareSurveySubmissionInBrowser(
  result: AnalysisResult,
  answers: SurveyAnswer,
  definitionId: string,
): Promise<SurveyPreparationOutcome> {
  try {
    const generation = storageGeneration
    const snapshot = await readBrowserPayload("analysisResult")
    if (snapshot.value === null)
      return { ok: false, reason: "analysis_mismatch" }
    const stored = await awaitTabResponse(
      unsealAnalysisResultAction(snapshot.value, getTabToken()),
    )
    if (stored.ok !== true) return { ok: false, reason: "write_failed" }
    const parsed = analysisResultSchema.safeParse(stored.result)
    if (parsed.success !== true) return { ok: false, reason: "write_failed" }
    if (parsed.data.analysisId !== result.analysisId)
      return { ok: false, reason: "analysis_mismatch" }
    if (stored.surveySubmitted === true)
      return { ok: false, reason: "survey_already_submitted" }
    if (
      parsed.data.pendingSurveyAnswer &&
      parsed.data.pendingQuestionnaireId !== definitionId
    )
      return { ok: false, reason: "questionnaire_changed" }
    const prepared = {
      ...parsed.data,
      pendingSurveyAnswer: parsed.data.pendingSurveyAnswer ?? { ...answers },
      pendingQuestionnaireId: definitionId,
    }
    const sealed = await awaitTabResponse(
      sealSurveyResultAction(prepared, getTabToken()),
    ).catch(() => ({
      ok: false as const,
      reason: "questionnaire_check_failed" as const,
    }))
    if (sealed.ok !== true) return sealed
    if (isTabOperationCurrent() !== true || generation !== storageGeneration)
      return { ok: false, reason: "storage_changed" }
    if (
      (await replaceBrowserPayload(
        "analysisResult",
        snapshot,
        sealed.sealedResult,
      )) !== true
    )
      return { ok: false, reason: "storage_changed" }
    return { ok: true, result: prepared }
  } catch {
    return { ok: false, reason: "write_failed" }
  }
}
