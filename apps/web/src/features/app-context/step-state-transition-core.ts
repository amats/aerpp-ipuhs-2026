import "server-only"

import { Stage } from "@/features/app-context/stage-types"

import { readStepStateFromSession } from "@/features/app-context/step-state-session"
import type { StepState } from "@/features/app-context/step-state-types"
import { isValidStepState } from "@/features/app-context/step-state-validation"
import {
  isLocallyAuthenticated,
  readLocalAuthenticationFromSession,
} from "@/features/auth/auth-session"
import {
  clearAnalysisStateFromSession,
  readLastCompletedAnalysisIdFromSession,
} from "@/features/llm/analysis-session"
import type { AppLogger } from "@/lib/logger"
import { LOG_EVENT } from "@/lib/logger-events"
import { type AppSession, getSession } from "@/lib/session"
import { readAnalysisOperation } from "@/lib/session-authority"
import { createStepStateLogger } from "./step-state-logger"

export type StepTransitionResult =
  | {
      ok: true
      consentContext?: string
      stepState: StepState
      recoveredSurveyAnalysisId?: string
      withdrawalCleanupPending?: boolean
      withdrawalStateWriteFailed?: boolean
    }
  | { ok: false; reason: string }

export type StepTransitionContext = {
  currentStepState: StepState
  logger: AppLogger
  session: AppSession
}

type BeginStepTransitionResult =
  | { ready: true; context: StepTransitionContext }
  | { ready: false; result: StepTransitionResult }

function matchesStepState(current: StepState, allowed: StepState[]) {
  return allowed.some(
    (stepState) =>
      current.stage === stepState.stage && current.step === stepState.step,
  )
}

function logSessionGetFailed({
  error,
  logger,
  operation,
}: {
  error: unknown
  logger: AppLogger
  operation: string
}) {
  logger.error({
    event: LOG_EVENT.sessionGetFailed,
    error,
    operation,
  })
}

function logStepStateWriteFailed({
  error,
  logger,
  stepState,
}: {
  error: unknown
  logger: AppLogger
  stepState: StepState
}) {
  logger.error({
    event: LOG_EVENT.sessionWriteFailed,
    error,
    rootStep: stepState.step,
    stage: stepState.stage,
    operation: "step_state_write",
  })
}

function logStepStateValidationRejected({
  logger,
  stepState,
}: {
  logger: AppLogger
  stepState: StepState
}) {
  logger.warn({
    event: LOG_EVENT.stepStateValidationRejected,
    outcome: "rejected",
    stage: stepState.stage,
    rootStep: stepState.step,
  })
}

export async function beginStepTransition({
  operation,
  allowed,
}: {
  operation: string
  allowed?: StepState[]
}): Promise<BeginStepTransitionResult> {
  const logger = await createStepStateLogger(operation)
  let session: AppSession
  try {
    session = await getSession()
  } catch (error) {
    logSessionGetFailed({ error, logger, operation })
    return {
      ready: false,
      result: { ok: false, reason: "step_state_write_failed" },
    }
  }

  const currentStepState = await readStepStateFromSession(session)
  if (allowed && matchesStepState(currentStepState, allowed) !== true) {
    logger.warn({
      event: LOG_EVENT.stepStateValidationRejected,
      operation: "current_state",
      outcome: "rejected",
      stage: currentStepState.stage,
      rootStep: currentStepState.step,
    })
    return {
      ready: false,
      result: { ok: false, reason: "stage_mismatch" },
    }
  }

  return {
    ready: true,
    context: { currentStepState, logger, session },
  }
}

export async function requireLocalAuthentication({
  logger,
  session,
}: StepTransitionContext): Promise<StepTransitionResult | null> {
  if (
    isLocallyAuthenticated(
      await readLocalAuthenticationFromSession(session),
    ) === true
  ) {
    return null
  }
  logger.warn({
    event: LOG_EVENT.authVerifyFailed,
    operation: "local_guard",
    outcome: "rejected",
  })
  return { ok: false, reason: "auth_mismatch" }
}

export function requireCompletedAnalysis(
  { logger, session }: StepTransitionContext,
  expectedAnalysisId: unknown,
): StepTransitionResult | null {
  const analysisId = readLastCompletedAnalysisIdFromSession(session)
  if (analysisId && analysisId === expectedAnalysisId) {
    return null
  }
  logger.warn({
    event: LOG_EVENT.stepStateValidationRejected,
    operation: "completed_analysis",
    outcome: "rejected",
  })
  return { ok: false, reason: "analysis_mismatch" }
}

export async function commitStepTransition({
  context: { logger, session },
  stepState,
  clearAuthentication = false,
  clearCompletedAnalysis = false,
  allowAnalysisCancellation = false,
  allowCompletedAnalysisRecovery = false,
}: {
  context: StepTransitionContext
  stepState: StepState
  clearAuthentication?: boolean
  clearCompletedAnalysis?: boolean
  allowAnalysisCancellation?: boolean
  allowCompletedAnalysisRecovery?: boolean
}): Promise<StepTransitionResult> {
  if (isValidStepState(stepState) !== true) {
    logStepStateValidationRejected({ logger, stepState })
    return { ok: false, reason: "step_state_write_failed" }
  }

  if (
    clearCompletedAnalysis === true &&
    stepState.stage !== Stage.withdrawn &&
    session.stage === Stage.authenticated &&
    session.lastCompletedAnalysisId &&
    session.submittedAnalysisId !== session.lastCompletedAnalysisId &&
    allowCompletedAnalysisRecovery !== true
  )
    return { ok: false, reason: "initial_survey_required" }
  // Detached inference releases the operation fence after admission. Ordinary
  // recovery/deletion must still protect its active or unknown execution.
  if (
    clearCompletedAnalysis === true &&
    stepState.stage !== Stage.withdrawn &&
    session.activeAnalysisId
  ) {
    const outcome = session.coordinationId
      ? readAnalysisOperation(session.coordinationId, session.activeAnalysisId)
      : null
    if (outcome === "completed") {
      if (allowCompletedAnalysisRecovery !== true)
        return { ok: false, reason: "analysis_completed" }
    } else if (
      outcome !== "failed" &&
      outcome !== "cancelled" &&
      allowAnalysisCancellation !== true
    )
      return {
        ok: false,
        reason:
          outcome === "running"
            ? "analysis_in_progress"
            : "analysis_unconfirmed",
      }
  }
  if (stepState.stage === Stage.unauthenticated) {
    delete session.withdrawalRequest
    delete session.withdrawalCleanupCompleted
  }
  session.stage = stepState.stage
  session.rootStep = stepState.step
  const clearsParticipantState =
    stepState.stage === Stage.unauthenticated ||
    stepState.stage === Stage.withdrawn
  if (clearAuthentication === true || clearsParticipantState === true) {
    delete session.authVerifiedAt
  }
  if (clearCompletedAnalysis === true || clearsParticipantState === true) {
    clearAnalysisStateFromSession(session)
  }

  try {
    await session.save()
    return { ok: true, stepState }
  } catch (error) {
    logStepStateWriteFailed({ error, logger, stepState })
    return { ok: false, reason: "step_state_write_failed" }
  }
}

export async function runStepTransition({
  operation,
  allowed,
  createNextStepState,
  requireLocalAuthentication: needsLocalAuthentication = false,
  requireCompletedAnalysis: needsCompletedAnalysis = false,
  expectedAnalysisId,
  clearAuthentication = false,
  clearCompletedAnalysis = false,
  allowAnalysisCancellation = false,
}: {
  operation: string
  allowed: StepState[]
  createNextStepState: (currentStepState: StepState) => StepState
  requireLocalAuthentication?: boolean
  requireCompletedAnalysis?: boolean
  expectedAnalysisId?: unknown
  clearAuthentication?: boolean
  clearCompletedAnalysis?: boolean
  allowAnalysisCancellation?: boolean
}): Promise<StepTransitionResult> {
  const started = await beginStepTransition({ operation, allowed })
  if (started.ready !== true) {
    return started.result
  }

  if (needsLocalAuthentication === true) {
    const rejection = await requireLocalAuthentication(started.context)
    if (rejection) {
      return rejection
    }
  }

  if (needsCompletedAnalysis === true) {
    const rejection = requireCompletedAnalysis(
      started.context,
      expectedAnalysisId,
    )
    if (rejection) {
      return rejection
    }
  }

  return await commitStepTransition({
    context: started.context,
    stepState: createNextStepState(started.context.currentStepState),
    clearAuthentication,
    clearCompletedAnalysis,
    allowAnalysisCancellation,
  })
}
