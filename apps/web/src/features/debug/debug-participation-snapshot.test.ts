import { describe, expect, it, vi } from "vitest"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import type { AppSession } from "@/lib/session"
import { readParticipationDebugSnapshotFromSession } from "./debug-participation-snapshot"

vi.mock("@/features/app-context/step-state-session", () => ({
  readStepStateFromSession: async () => ({
    stage: Stage.followUp,
    step: RootStep.thanks,
  }),
}))

describe("participation debug snapshot", () => {
  it("shows accepted recovered flow without exposing identifiers or saving", async () => {
    const id = `aerpp:aid-${"a".repeat(32)}`
    const session = {
      questionnaireKind: "follow-up",
      lastCompletedAnalysisId: id,
      submittedAnalysisId: id,
      recoveredSurveyAnalysisId: id,
      save: vi.fn(),
    }
    expect(
      await readParticipationDebugSnapshotFromSession(
        session as unknown as AppSession,
      ),
    ).toEqual({
      stage: Stage.followUp,
      rootStep: RootStep.thanks,
      questionnaireKind: "follow-up",
      surveyAccepted: true,
      recoveredSurvey: true,
    })
    expect(session.save).not.toHaveBeenCalled()
  })
  it.each([
    {},
    {
      questionnaireKind: "invalid",
      lastCompletedAnalysisId: "invalid",
      submittedAnalysisId: "invalid",
      recoveredSurveyAnalysisId: "invalid",
    },
  ])(
    "keeps missing or malformed confirmation unknown (%j)",
    async (session) => {
      expect(
        await readParticipationDebugSnapshotFromSession(session as AppSession),
      ).toMatchObject({
        questionnaireKind: null,
        surveyAccepted: false,
        recoveredSurvey: false,
      })
    },
  )
})
