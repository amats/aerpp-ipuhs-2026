import "server-only"

import { z } from "zod"
import {
  RootStep,
  rootStepSchema,
} from "@/features/app-context/root-step-types"
import { Stage, stageSchema } from "@/features/app-context/stage-types"
import { INITIAL_STEP_STATE } from "@/features/app-context/step-state-constants"
import { LOG_EVENT } from "@/lib/logger-events"
import { type AppSession, getSession } from "@/lib/session"
import { createStepStateLogger } from "./step-state-logger"
import type { StepState } from "./step-state-types"
import {
  isValidStepState,
  normalizePersistedStepState,
} from "./step-state-validation"

const stepStateSessionSchema = z.object({
  stage: stageSchema.catch(Stage.unauthenticated),
  step: rootStepSchema.catch(RootStep.start),
})

/*
 * Step-state session reads:
 * - Treat persisted stage/rootStep values as external input.
 * - Validate and normalize values before they cross into app flow code.
 * - Root rendering reads normalized initial state through readInitialStepState()
 *   without writing cookies. Intent actions own all state persistence.
 * - Keep StepState writes behind intent actions so the server decides which
 *   transitions can be persisted.
 */

export async function readStepStateFromSession(
  session: AppSession,
): Promise<StepState> {
  const logger = await createStepStateLogger("read_step_state")

  const currentStepState = normalizePersistedStepState(
    stepStateSessionSchema.parse({
      stage: session.stage,
      step: session.rootStep,
    }),
  )
  if (!isValidStepState(currentStepState)) {
    logger.warn({
      event: LOG_EVENT.stepStateValidationRejected,
      outcome: "rejected",
      stage: currentStepState.stage,
      rootStep: currentStepState.step,
    })
    return INITIAL_STEP_STATE
  }
  return currentStepState
}

export async function readInitialStepState(): Promise<StepState> {
  const logger = await createStepStateLogger("read_initial_step_state")
  let session: AppSession
  try {
    session = await getSession()
  } catch (error) {
    logger.error({
      error,
      event: LOG_EVENT.sessionGetFailed,
      operation: "step_state_read",
    })
    return INITIAL_STEP_STATE
  }

  return await readStepStateFromSession(session)
}

export function readStageFromSession(session: AppSession): Stage {
  return stageSchema.catch(Stage.unauthenticated).parse(session.stage)
}
