import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import type { StepState } from "./step-state-types"

export function isValidStepState(stepState: StepState): boolean {
  switch (stepState.step) {
    case RootStep.start:
    case RootStep.explanation:
    case RootStep.consent:
      return stepState.stage === Stage.unauthenticated
    case RootStep.auth:
      return stepState.stage === Stage.confirmationSent
    case RootStep.document:
    case RootStep.result:
    case RootStep.survey:
    case RootStep.thanks:
      return (
        stepState.stage === Stage.authenticated ||
        stepState.stage === Stage.followUp
      )
    case RootStep.withdrawn:
      return stepState.stage === Stage.withdrawn
    default:
      return false
  }
}

export function normalizePersistedStepState(stepState: StepState): StepState {
  if (stepState.stage === Stage.withdrawn) {
    return {
      stage: Stage.withdrawn,
      step: RootStep.withdrawn,
    }
  }

  return stepState
}
