"use client"

import {
  isBrowserPayloadCurrent,
  readBrowserPayload,
  replaceBrowserPayload,
} from "@/lib/browser-session"
import { awaitTabResponse, isTabOperationCurrent } from "@/lib/tab-cancellation"
import { getTabToken } from "@/lib/tab-token"
import {
  sealRecoveredSurveyDraftAction,
  unsealRecoveredSurveyDraftAction,
} from "./actions-survey-recovery-seal"
import type { RecoveredSurveyDraft } from "./survey-recovery-types"

export async function clearRecoveredSurveyDraft(expected: string) {
  const snapshot = await readBrowserPayload("recoveredSurvey")
  if (snapshot.value !== null && snapshot.value !== expected) return false
  return replaceBrowserPayload("recoveredSurvey", snapshot, null)
}

export async function readRecoveredSurveyDraft() {
  const snapshot = await readBrowserPayload("recoveredSurvey")
  if (snapshot.value === null) return null
  const result = await awaitTabResponse(
    unsealRecoveredSurveyDraftAction(snapshot.value, getTabToken()),
  )
  if (
    result.ok !== true ||
    isTabOperationCurrent() !== true ||
    (await isBrowserPayloadCurrent("recoveredSurvey", snapshot)) !== true
  )
    throw new Error("draft_unavailable")
  return result.draft
}

export async function freezeRecoveredSurveyDraft(draft: RecoveredSurveyDraft) {
  const snapshot = await readBrowserPayload("recoveredSurvey")
  if (snapshot.value !== null) {
    const opened = await awaitTabResponse(
      unsealRecoveredSurveyDraftAction(snapshot.value, getTabToken()),
    )
    if (
      opened.ok !== true ||
      isTabOperationCurrent() !== true ||
      (await isBrowserPayloadCurrent("recoveredSurvey", snapshot)) !== true ||
      opened.draft.analysisId !== draft.analysisId ||
      opened.draft.definitionId !== draft.definitionId
    )
      throw new Error("draft_conflict")
    return { draft: opened.draft, sealed: snapshot.value }
  }
  const result = await awaitTabResponse(
    sealRecoveredSurveyDraftAction(draft, getTabToken()),
  )
  if (
    result.ok !== true ||
    isTabOperationCurrent() !== true ||
    (await replaceBrowserPayload(
      "recoveredSurvey",
      snapshot,
      result.sealed,
    )) !== true
  )
    throw new Error("draft_write_failed")
  return { draft, sealed: result.sealed }
}
