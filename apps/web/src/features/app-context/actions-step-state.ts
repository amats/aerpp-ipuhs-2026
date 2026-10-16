"use server"

import { prepareWithdrawalRequest } from "@/features/auth/auth-service"
import {
  withSessionOperation,
  withSessionRead,
  withWithdrawalCleanupOperation,
  withWithdrawalOperation,
} from "@/features/session/session-operation"
import type { SurveyAnswer } from "@/features/survey/survey-answer-types"
import {
  validatePreparedWithdrawalRequest,
  validateWithdrawalDocumentSet,
} from "@/features/withdraw/withdrawal-session"
import { getSession } from "@/lib/session"
import {
  cancelAnalysis,
  completeSurveySubmission,
  completeWithdrawal,
  confirmAuthenticationAndPrepareAnalysis,
  correctConsentEmail,
  failAnalysis,
  moveToConsent,
  moveToExplanation,
  moveToOverview,
  prepareConsentContext,
  prepareNewAnalysis,
  recoverUnavailableAnalysis,
  resendConsentEmail,
  resetFlow,
  returnToResult,
  type StepTransitionResult,
  sendConsentEmailAndMoveToAuth,
  startAnalysis,
  startSurvey,
} from "./step-state-transition-service"

/*
 * Intent-only Server Action boundary for the app flow.
 * - Expose named user intents to the client app-context flow.
 * - Keep intent rules in the transition service and shared persistence mechanics
 *   in step-state-transition-core.ts.
 * - Do not export generic StepState write actions from this file.
 */

export async function moveToExplanationAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withSessionRead(tabToken, moveToExplanation)
}

export async function moveToOverviewAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withSessionRead(tabToken, moveToOverview)
}

export async function moveToConsentAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withSessionRead(tabToken, moveToConsent)
}

export async function prepareConsentContextAction(
  email: string,
  tabToken?: string,
  displayedSha256?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "ordinary", () =>
    typeof displayedSha256 === "string"
      ? prepareConsentContext(email, displayedSha256)
      : Promise.resolve({ ok: false as const, reason: "document_set_changed" }),
  )
}

export async function sendConsentEmailAndMoveToAuthAction(
  email: string,
  tabToken?: string,
  consentContext?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "ordinary", () =>
    sendConsentEmailAndMoveToAuth(email, consentContext),
  )
}

export async function resendConsentEmailAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "ordinary", () =>
    resendConsentEmail(),
  )
}

export async function confirmAuthenticationAndPrepareAnalysisAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "ordinary", () =>
    confirmAuthenticationAndPrepareAnalysis(),
  )
}

export async function prepareNewAnalysisAction(
  expectedAnalysisId: string | null = null,
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "ordinary", () =>
    prepareNewAnalysis(expectedAnalysisId),
  )
}

export async function startAnalysisAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "ordinary", () => startAnalysis())
}

export async function cancelAnalysisAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  // Local cancellation must remain available while Support is unreachable.
  return await withSessionOperation(tabToken, "analysis_cleanup", () =>
    cancelAnalysis(),
  )
}

export async function failAnalysisAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "analysis_cleanup", () =>
    failAnalysis(),
  )
}

export async function recoverUnavailableAnalysisAction(
  analysisId: unknown,
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withSessionOperation(tabToken, "ordinary", () =>
    recoverUnavailableAnalysis(analysisId),
  )
}

export async function startSurveyAction(
  expectedAnalysisId: string,
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withSessionRead(tabToken, () => startSurvey(expectedAnalysisId))
}

export async function returnToResultAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withSessionRead(tabToken, returnToResult)
}

export async function completeSurveySubmissionAction(
  surveyAnswer: SurveyAnswer,
  expectedAnalysisId: string,
  definitionId: string,
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "survey", () =>
    completeSurveySubmission(surveyAnswer, expectedAnalysisId, definitionId),
  )
}

export async function completeWithdrawalAction(
  email: string,
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withWithdrawalOperation(
    tabToken,
    email,
    () => completeWithdrawal(email),
    validatePreparedWithdrawalRequest,
  )
}

export async function prepareWithdrawalAction(
  email: string,
  tabToken?: string,
  displayedSha256?: string,
) {
  return withWithdrawalOperation(
    tabToken,
    email,
    async () =>
      prepareWithdrawalRequest(
        await getSession(),
        email,
        displayedSha256 ?? "",
      ),
    (session) => validateWithdrawalDocumentSet(session, displayedSha256 ?? ""),
  )
}

export async function correctConsentEmailAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return withSessionOperation(tabToken, "ordinary", correctConsentEmail)
}

export async function retryWithdrawalCleanupAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withWithdrawalCleanupOperation(tabToken, () =>
    completeWithdrawal(),
  )
}

export async function readWithdrawalCleanupAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withWithdrawalCleanupOperation(tabToken, () =>
    completeWithdrawal(undefined, true),
  )
}

async function resetFlowAction(
  tabToken?: string,
): Promise<StepTransitionResult> {
  return await withSessionOperation(tabToken, "ordinary", () => resetFlow())
}

export { resetFlowAction, type StepTransitionResult }
