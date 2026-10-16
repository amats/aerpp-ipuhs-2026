import { matchesSurveyDefinition } from "@/features/survey/survey-answer-validation"
import "server-only"

import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import type { StepState } from "@/features/app-context/step-state-types"
import {
  prepareConsentForEmail,
  sendMagicLinkEmail,
  verifyAuthentication,
  withdrawParticipation,
} from "@/features/auth/auth-service"
import { readEmailFromSession } from "@/features/auth/email"
import { recordUnavailableAnalysis } from "@/features/llm/analysis-attempt"
import {
  cancelAnalysisJobFromSession,
  readAnalysisJobStatusFromSession,
} from "@/features/llm/analysis-job-access"
import { analysisIdSchema } from "@/features/llm/analysis-receipt-types"
import type { SurveyAnswer } from "@/features/survey/survey-answer-types"
import { submitSurvey } from "@/features/survey/survey-service"
import {
  readWithdrawalCleanupCompletedFromSession,
  readWithdrawalRequestFromSession,
} from "@/features/withdraw/withdrawal-session"
import { LOG_EVENT } from "@/lib/logger-events"
import type { AppSession } from "@/lib/session"
import {
  beginStepTransition,
  commitStepTransition,
  requireCompletedAnalysis,
  requireLocalAuthentication,
  runStepTransition,
  type StepTransitionResult,
} from "./step-state-transition-core"

export type { StepTransitionResult } from "./step-state-transition-core"

/*
 * Complete intent-level workflow for StepState transitions.
 *
 * Read this file from top to bottom in participant-flow order. Keep intent
 * rules and their external side effects here so one workflow does not require
 * tracing multiple transition modules. The shared core owns only session,
 * guard, validation, persistence, and logging mechanics.
 *
 * Invariants:
 * - The server derives every next StepState from a named intent.
 * - Authenticated/follow-up transitions require local authentication unless
 *   the intent performs its own upstream authentication or withdrawal check.
 * - Withdrawn is terminal except for the explicit reset recovery path.
 * - A new analysis clears any prior completed-analysis receipt.
 * - Survey entry and submission must match the displayed analysis to the
 *   server-owned completed-analysis ID before any survey side effect.
 *
 * See docs/architecture.md and the table-driven action tests for the readable
 * transition map and executable boundary coverage.
 */

function isAuthenticatedStepState(current: StepState) {
  return (
    current.stage === Stage.authenticated || current.stage === Stage.followUp
  )
}

async function prepareAnalysisStepState({
  operation,
  allowed,
  verifyUpstreamAuthentication = false,
  expectedAnalysisId,
}: {
  operation: string
  allowed: StepState[]
  verifyUpstreamAuthentication?: boolean
  expectedAnalysisId?: string | null
}): Promise<StepTransitionResult> {
  const started = await beginStepTransition({ operation, allowed })
  if (started.ready !== true) {
    return started.result
  }

  if (operation === "prepare_new_analysis") {
    const session = started.context.session
    // A restored survey may have no browser result. Only the accepted survey's
    // Thanks state can omit its ID; all other screens must supply the receipt.
    const acceptedWithoutResult =
      expectedAnalysisId === null &&
      started.context.currentStepState.stage === Stage.followUp &&
      started.context.currentStepState.step === RootStep.thanks &&
      analysisIdSchema.safeParse(session.lastCompletedAnalysisId).success ===
        true &&
      session.submittedAnalysisId === session.lastCompletedAnalysisId
    if (
      acceptedWithoutResult !== true &&
      ((session.lastCompletedAnalysisId ?? null) !== expectedAnalysisId ||
        (expectedAnalysisId === null &&
          started.context.currentStepState.step === RootStep.thanks))
    )
      return { ok: false, reason: "analysis_mismatch" }
    if (
      session.pendingSurveyAnalysisId &&
      session.submittedAnalysisId !== session.pendingSurveyAnalysisId
    )
      return { ok: false, reason: "submission_pending" }
    if (
      session.lastCompletedAnalysisId &&
      session.stage === Stage.authenticated
    )
      return { ok: false, reason: "initial_survey_required" }
  }
  if (verifyUpstreamAuthentication === true) {
    const verified = await verifyAuthentication(started.context.session)
    if (verified.ok !== true) {
      return { ok: false, reason: verified.reason ?? "auth_failed" }
    }
    delete started.context.session.adminRecoveryPseudonym
    delete started.context.session.adminRecoveryId
    delete started.context.session.adminRecoveryCleanupPending
    if (verified.recoveredSurveyAnalysisId) {
      const session = started.context.session
      session.recoveredSurveyAnalysisId = verified.recoveredSurveyAnalysisId
      session.lastCompletedAnalysisId = verified.recoveredSurveyAnalysisId
      session.presentedAnalysisId = verified.recoveredSurveyAnalysisId
      const result = await commitStepTransition({
        context: started.context,
        stepState: { stage: Stage.authenticated, step: RootStep.survey },
      })
      return result.ok === true
        ? {
            ...result,
            recoveredSurveyAnalysisId: verified.recoveredSurveyAnalysisId,
          }
        : result
    }
  }

  const authenticationRejection = await requireLocalAuthentication(
    started.context,
  )
  if (authenticationRejection) {
    return authenticationRejection
  }

  const kind = started.context.session.questionnaireKind
  if (kind !== "initial" && kind !== "follow-up") {
    return { ok: false, reason: "stage_resolution_failed" }
  }

  return await commitStepTransition({
    context: started.context,
    stepState: {
      stage: kind === "follow-up" ? Stage.followUp : Stage.authenticated,
      step: RootStep.document,
    },
    clearCompletedAnalysis: true,
  })
}

// Pre-consent and authentication transitions.
export async function beginAdminRecovery(
  recoveryId: string,
): Promise<StepTransitionResult> {
  const started = await beginStepTransition({ operation: "admin_recovery" })
  if (started.ready !== true) return started.result
  const session = started.context.session
  // A lost reset response must not discard a newly prepared/confirmed consent.
  if (session.adminRecoveryId === recoveryId) {
    return session.consentId
      ? { ok: false, reason: "recovery_in_progress" }
      : {
          ok: true,
          stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
        }
  }
  session.adminRecoveryPseudonym ??= session.pseudonym
  session.pseudonym = session.adminRecoveryPseudonym
  session.adminRecoveryId = recoveryId
  session.adminRecoveryCleanupPending = true
  delete session.email
  delete session.consentId
  delete session.preparedConsentContext
  delete session.lastConsentMailAt
  delete session.lastConsentMailId
  delete session.questionnaireKind
  return commitStepTransition({
    context: started.context,
    stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
    clearCompletedAnalysis: true,
    clearAuthentication: true,
    allowAnalysisCancellation: true,
    allowCompletedAnalysisRecovery: true,
  })
}

export async function moveToExplanation(): Promise<StepTransitionResult> {
  return moveIntroView(RootStep.explanation)
}

export async function moveToConsent(): Promise<StepTransitionResult> {
  return moveIntroView(RootStep.consent)
}

const INTRO_STATES = [
  RootStep.start,
  RootStep.explanation,
  RootStep.consent,
].map((step) => ({ stage: Stage.unauthenticated, step }))

async function moveIntroView(
  step:
    | typeof RootStep.start
    | typeof RootStep.explanation
    | typeof RootStep.consent,
): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "move_intro_view",
    allowed: INTRO_STATES,
  })
  return started.ready === true
    ? { ok: true, stepState: { stage: Stage.unauthenticated, step } }
    : started.result
}

export async function moveToOverview(): Promise<StepTransitionResult> {
  return moveIntroView(RootStep.start)
}

export async function prepareConsentContext(
  email: string,
  displayedSha256?: string,
): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "prepare_consent",
    allowed: INTRO_STATES,
  })
  if (started.ready !== true) return started.result
  const prepared = await prepareConsentForEmail(
    started.context.session,
    email,
    displayedSha256,
  )
  return prepared.ok === true
    ? {
        ...prepared,
        stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
      }
    : { ok: false, reason: prepared.reason ?? "consent_context_failed" }
}

export async function sendConsentEmailAndMoveToAuth(
  email: string,
  consentContext?: string,
): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "send_consent_email",
    allowed: INTRO_STATES,
  })
  if (started.ready !== true) {
    return started.result
  }

  const sent = await sendMagicLinkEmail(
    started.context.session,
    email,
    consentContext,
  )
  if (sent.ok !== true) {
    return { ok: false, reason: sent.reason ?? "send_failed" }
  }

  return await commitStepTransition({
    context: started.context,
    stepState: {
      stage: Stage.confirmationSent,
      step: RootStep.auth,
    },
    clearAuthentication: true,
  })
}

export async function resendConsentEmail(): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "resend_consent_email",
    allowed: [{ stage: Stage.confirmationSent, step: RootStep.auth }],
  })
  if (started.ready !== true) return started.result
  const { session, currentStepState, logger } = started.context
  try {
    const email = await readEmailFromSession(session)
    if (!email || !session.preparedConsentContext || !session.consentId)
      return { ok: false, reason: "consent_context_invalid" }
    const sent = await sendMagicLinkEmail(
      session,
      email,
      session.preparedConsentContext,
    )
    return sent.ok === true
      ? { ok: true, stepState: currentStepState }
      : { ok: false, reason: sent.reason ?? "send_failed" }
  } catch (error) {
    logger.error({ event: LOG_EVENT.authMagicLinkFailed, error })
    return { ok: false, reason: "send_failed" }
  }
}

export async function confirmAuthenticationAndPrepareAnalysis(): Promise<StepTransitionResult> {
  return await prepareAnalysisStepState({
    operation: "confirm_authentication_prepare_analysis",
    allowed: [{ stage: Stage.confirmationSent, step: RootStep.auth }],
    verifyUpstreamAuthentication: true,
  })
}

// Analysis transitions.
export async function prepareNewAnalysis(
  expectedAnalysisId: string | null = null,
): Promise<StepTransitionResult> {
  return await prepareAnalysisStepState({
    operation: "prepare_new_analysis",
    expectedAnalysisId,
    allowed: [
      { stage: Stage.authenticated, step: RootStep.result },
      { stage: Stage.followUp, step: RootStep.result },
      { stage: Stage.authenticated, step: RootStep.survey },
      { stage: Stage.followUp, step: RootStep.survey },
      { stage: Stage.followUp, step: RootStep.thanks },
    ],
  })
}

export async function startAnalysis(): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "start_analysis",
    allowed: [
      { stage: Stage.authenticated, step: RootStep.document },
      { stage: Stage.followUp, step: RootStep.document },
    ],
  })
  if (started.ready !== true) return started.result
  const rejection = await requireLocalAuthentication(started.context)
  if (rejection) return rejection
  return commitStepTransition({
    context: started.context,
    stepState: {
      stage: started.context.currentStepState.stage,
      step: RootStep.result,
    },
    clearCompletedAnalysis: true,
  })
}

export async function cancelAnalysis(): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "cancel_analysis",
    allowed: [
      { stage: Stage.authenticated, step: RootStep.result },
      { stage: Stage.followUp, step: RootStep.result },
    ],
  })
  if (started.ready !== true) return started.result
  const rejection = await requireLocalAuthentication(started.context)
  if (rejection) return rejection
  const status = await cancelAnalysisJobFromSession(started.context.session)
  if (status.status === "termination_pending")
    return { ok: false, reason: "analysis_termination_pending" }
  if (["ready", "recording", "completion_pending"].includes(status.status))
    return { ok: false, reason: "analysis_completed" }
  // The ordinary transition guard releases only confirmed failed/cancelled work.
  return commitStepTransition({
    context: started.context,
    stepState: {
      stage: started.context.currentStepState.stage,
      step: RootStep.document,
    },
    clearCompletedAnalysis: true,
  })
}

export async function failAnalysis(): Promise<StepTransitionResult> {
  return await runStepTransition({
    operation: "fail_analysis",
    allowed: [
      { stage: Stage.authenticated, step: RootStep.survey },
      { stage: Stage.followUp, step: RootStep.survey },
      { stage: Stage.authenticated, step: RootStep.result },
      { stage: Stage.followUp, step: RootStep.result },
    ],
    createNextStepState: (currentStepState) => ({
      stage: currentStepState.stage,
      step: RootStep.document,
    }),
    requireLocalAuthentication: true,
    clearCompletedAnalysis: true,
  })
}

// Confirm output loss in Support before releasing work allowed by the initial-survey boundary.
export async function recoverUnavailableAnalysis(
  expectedAnalysisId: unknown,
): Promise<StepTransitionResult> {
  const id = analysisIdSchema.safeParse(expectedAnalysisId)
  if (id.success !== true) return { ok: false, reason: "analysis_mismatch" }
  const started = await beginStepTransition({
    operation: "recover_unavailable_analysis",
    allowed: [
      { stage: Stage.authenticated, step: RootStep.result },
      { stage: Stage.followUp, step: RootStep.result },
    ],
  })
  if (started.ready !== true) return started.result
  const rejection = await requireLocalAuthentication(started.context)
  if (rejection) return rejection
  const status = await readAnalysisJobStatusFromSession(started.context.session)
  if (status.analysisId !== id.data)
    return { ok: false, reason: "analysis_mismatch" }
  if (status.status !== "unavailable" || status.canRecover !== true)
    return { ok: false, reason: "analysis_recovery_unavailable" }
  const recorded = await recordUnavailableAnalysis({
    analysisId: id.data,
    session: started.context.session,
    logger: started.context.logger,
  })
  if (recorded !== true)
    return { ok: false, reason: "analysis_recovery_unconfirmed" }
  return commitStepTransition({
    context: started.context,
    stepState: {
      stage: started.context.currentStepState.stage,
      step: RootStep.document,
    },
    clearCompletedAnalysis: true,
    allowCompletedAnalysisRecovery: true,
    allowAnalysisCancellation: true,
  })
}

// Survey/result navigation validates shared work but returns a per-tab view.
export async function startSurvey(
  expectedAnalysisId: string,
): Promise<StepTransitionResult> {
  const started = await beginStepTransition({ operation: "start_survey" })
  if (started.ready !== true) return started.result
  const rejection =
    (await requireLocalAuthentication(started.context)) ??
    requireCompletedAnalysis(started.context, expectedAnalysisId)
  if (rejection) return rejection
  if (started.context.session.submittedAnalysisId === expectedAnalysisId)
    return { ok: false, reason: "survey_already_submitted" }
  return {
    ok: true,
    stepState: {
      stage: started.context.currentStepState.stage,
      step: RootStep.survey,
    },
  }
}

export async function returnToResult(): Promise<StepTransitionResult> {
  const started = await beginStepTransition({ operation: "return_to_result" })
  if (started.ready !== true) return started.result
  const rejection = await requireLocalAuthentication(started.context)
  if (rejection) return rejection
  return {
    ok: true,
    stepState: {
      stage: started.context.currentStepState.stage,
      step: RootStep.result,
    },
  }
}

export async function completeSurveySubmission(
  surveyAnswer: SurveyAnswer,
  expectedAnalysisId: string,
  definitionId: unknown,
): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "complete_survey_submission",
    allowed: [
      { stage: Stage.authenticated, step: RootStep.result },
      { stage: Stage.followUp, step: RootStep.result },
      { stage: Stage.authenticated, step: RootStep.survey },
      { stage: Stage.followUp, step: RootStep.survey },
    ],
  })
  if (started.ready !== true) {
    return started.result
  }

  const authenticationRejection = await requireLocalAuthentication(
    started.context,
  )
  if (authenticationRejection) {
    return authenticationRejection
  }

  const analysisRejection = requireCompletedAnalysis(
    started.context,
    expectedAnalysisId,
  )
  if (analysisRejection) return analysisRejection

  if (started.context.session.submittedAnalysisId === expectedAnalysisId)
    return { ok: false, reason: "survey_already_submitted" }
  if (
    matchesSurveyDefinition(
      started.context.currentStepState.stage,
      definitionId,
    ) !== true
  )
    return { ok: false, reason: "questionnaire_changed" }
  started.context.session.pendingSurveyAnalysisId = expectedAnalysisId
  try {
    await started.context.session.save()
  } catch (error) {
    started.context.logger.error({ event: LOG_EVENT.sessionWriteFailed, error })
    return { ok: false, reason: "step_state_write_failed" }
  }
  const submitted = await submitSurvey(
    started.context.session,
    surveyAnswer,
    definitionId,
  )
  if (submitted.ok !== true) {
    return { ok: false, reason: submitted.reason ?? "submit_failed" }
  }

  started.context.session.questionnaireKind = "follow-up"
  started.context.session.submittedAnalysisId = expectedAnalysisId
  delete started.context.session.recoveredSurveyAnalysisId
  delete started.context.session.pendingSurveyAnalysisId
  const committed = await commitStepTransition({
    context: started.context,
    stepState: {
      stage: Stage.followUp,
      step: RootStep.thanks,
    },
  })
  return committed.ok === true
    ? committed
    : { ok: false, reason: "survey_submitted_state_write_failed" }
}

// Terminal and recovery transitions.
export async function completeWithdrawal(
  email?: string,
  checkOnly = false,
): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "complete_withdrawal",
  })
  if (started.ready !== true) {
    return started.result
  }

  if (email === undefined) {
    const withdrawn = started.context.currentStepState.stage === Stage.withdrawn
    if (
      !withdrawn &&
      isAuthenticatedStepState(started.context.currentStepState) !== true
    )
      return { ok: false, reason: "stage_mismatch" }
    if (
      withdrawn &&
      readWithdrawalCleanupCompletedFromSession(started.context.session) ===
        true
    )
      return {
        ok: true,
        stepState: started.context.currentStepState,
      }
    if (checkOnly === true) {
      return withdrawn
        ? {
            ok: true,
            stepState: started.context.currentStepState,
            withdrawalCleanupPending: true,
          }
        : { ok: false, reason: "stage_mismatch" }
    }
    if (!readWithdrawalRequestFromSession(started.context.session))
      return { ok: false, reason: "withdraw_failed" }
    const storedEmail = await readEmailFromSession(started.context.session)
    if (!storedEmail) return { ok: false, reason: "withdraw_failed" }
    email = storedEmail
  }

  if (
    isAuthenticatedStepState(started.context.currentStepState) !== true &&
    started.context.currentStepState.stage !== Stage.withdrawn
  ) {
    started.context.logger.warn({
      event: LOG_EVENT.stepStateValidationRejected,
      operation: "current_state",
      outcome: "rejected",
      stage: started.context.currentStepState.stage,
      rootStep: started.context.currentStepState.step,
    })
    return { ok: false, reason: "stage_mismatch" }
  }

  const withdrawn = await withdrawParticipation(started.context.session, email)
  if (withdrawn.ok !== true) {
    return { ok: false, reason: withdrawn.reason ?? "withdraw_failed" }
  }

  const stepState = { stage: Stage.withdrawn, step: RootStep.withdrawn }
  started.context.session.withdrawalCleanupCompleted =
    withdrawn.cleanupPending === false
  const committed = await commitStepTransition({
    context: started.context,
    stepState,
    clearAuthentication: true,
    clearCompletedAnalysis: true,
  })
  // Upstream withdrawal is final even if the authoritative session state cannot be saved.
  return {
    ok: true,
    stepState,
    ...(withdrawn.cleanupPending === true
      ? { withdrawalCleanupPending: true }
      : {}),
    ...(committed.ok !== true ? { withdrawalStateWriteFailed: true } : {}),
  }
}

async function recoveryConsentRestartRejection(
  session: AppSession,
): Promise<StepTransitionResult | null> {
  if (!session.adminRecoveryId || session.stage !== Stage.confirmationSent)
    return null
  // The emailed link can consume the grant while this page is open. Only an
  // expired challenge proves that discarding its owner cannot lose recovery.
  const verified = await verifyAuthentication(session)
  return verified.ok === false && verified.reason === "auth_expired"
    ? null
    : { ok: false, reason: "recovery_authentication_required" }
}

export async function resetFlow(): Promise<StepTransitionResult> {
  const started = await beginStepTransition({ operation: "reset_flow" })
  if (started.ready !== true) {
    return started.result
  }

  const recoveryRejection = await recoveryConsentRestartRejection(
    started.context.session,
  )
  if (recoveryRejection) return recoveryRejection

  if (started.context.currentStepState.stage === Stage.confirmationSent)
    delete started.context.session.preparedConsentContext

  return await commitStepTransition({
    context: started.context,
    stepState: {
      stage: Stage.unauthenticated,
      step: RootStep.start,
    },
    clearAuthentication: true,
    clearCompletedAnalysis: true,
  })
}

export async function correctConsentEmail(): Promise<StepTransitionResult> {
  const started = await beginStepTransition({
    operation: "correct_consent_email",
    allowed: [{ stage: Stage.confirmationSent, step: RootStep.auth }],
  })
  if (started.ready !== true) return started.result
  const session = started.context.session
  const recoveryRejection = await recoveryConsentRestartRejection(session)
  if (recoveryRejection) return recoveryRejection
  delete session.email
  delete session.preparedConsentContext
  delete session.consentId
  delete session.clientId
  delete session.pseudonym
  return commitStepTransition({
    context: started.context,
    stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
    clearAuthentication: true,
    clearCompletedAnalysis: true,
  })
}
