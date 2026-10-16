import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import type { StepState } from "./step-state-types"

export const INITIAL_STEP_STATE: StepState = {
  stage: Stage.unauthenticated,
  step: RootStep.start,
}
