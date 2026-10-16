import type { RootStep } from "@/features/app-context/root-step-types"
import type { Stage } from "@/features/app-context/stage-types"

export type StepState = {
  stage: Stage
  step: RootStep
}
