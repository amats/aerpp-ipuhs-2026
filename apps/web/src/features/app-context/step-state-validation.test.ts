import { describe, expect, it } from "vitest"
import { RootStep } from "./root-step-types"
import { Stage } from "./stage-types"
import type { StepState } from "./step-state-types"
import {
  isValidStepState,
  normalizePersistedStepState,
} from "./step-state-validation"

const VALID_STEP_STATES: StepState[] = [
  { stage: Stage.unauthenticated, step: RootStep.start },
  { stage: Stage.unauthenticated, step: RootStep.explanation },
  { stage: Stage.unauthenticated, step: RootStep.consent },
  { stage: Stage.confirmationSent, step: RootStep.auth },
  { stage: Stage.authenticated, step: RootStep.document },
  { stage: Stage.authenticated, step: RootStep.result },
  { stage: Stage.authenticated, step: RootStep.survey },
  { stage: Stage.authenticated, step: RootStep.thanks },
  { stage: Stage.followUp, step: RootStep.document },
  { stage: Stage.followUp, step: RootStep.result },
  { stage: Stage.followUp, step: RootStep.survey },
  { stage: Stage.followUp, step: RootStep.thanks },
  { stage: Stage.withdrawn, step: RootStep.withdrawn },
]

describe("step-state validation", () => {
  it("accepts exactly the declared stage and root-step combinations", () => {
    const validKeys = new Set(
      VALID_STEP_STATES.map(({ stage, step }) => `${stage}:${step}`),
    )

    for (const stage of Object.values(Stage)) {
      for (const step of Object.values(RootStep)) {
        expect(isValidStepState({ stage, step })).toBe(
          validKeys.has(`${stage}:${step}`),
        )
      }
    }
  })

  it.each(Object.values(RootStep))(
    "normalizes withdrawn persistence from the %s root step",
    (step) => {
      expect(
        normalizePersistedStepState({ stage: Stage.withdrawn, step }),
      ).toEqual({ stage: Stage.withdrawn, step: RootStep.withdrawn })
    },
  )
})
