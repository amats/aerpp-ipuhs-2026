import { beforeEach, expect, it, vi } from "vitest"
import { surveyQuestionSets } from "./survey-question-sets"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  seal: vi.fn(),
  unseal: vi.fn(),
}))
vi.mock("@/features/session/session-operation", () => ({
  withSessionRead: async (_token: unknown, operation: () => unknown) =>
    operation(),
}))
vi.mock("@/lib/session", () => ({ getSession: mocks.session }))
vi.mock("@/lib/session-seal", () => ({
  sealSessionData: mocks.seal,
  unsealSessionData: mocks.unseal,
}))

import {
  sealRecoveredSurveyDraftAction,
  unsealRecoveredSurveyDraftAction,
} from "./actions-survey-recovery-seal"

const analysisId = `aerpp:aid-${"a".repeat(32)}`
const owner = {
  coordinationId: "11111111-1111-4111-8111-111111111111",
  consentId: "current-consent",
  clientId: "browser",
  pseudonym: "participant",
  authVerifiedAt: "2026-10-01T00:00:00.000Z",
  stage: "authenticated",
  rootStep: "survey",
  recoveredSurveyAnalysisId: analysisId,
  lastCompletedAnalysisId: analysisId,
}
const draft = {
  analysisId,
  definitionId: surveyQuestionSets.initialSurveyQuestionSet.definitionId,
  answers: Object.fromEntries(
    surveyQuestionSets.initialSurveyQuestionSet.questions
      .filter((item) => item.type !== "section")
      .map((item) => [
        item.id,
        item.type === "text" ? "Synthetic answer" : item.options[0],
      ]),
  ),
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ ...owner })
  mocks.seal.mockResolvedValue("synthetic-owner-bound-seal")
  mocks.unseal.mockResolvedValue({
    purpose: "recovered-survey",
    coordinationId: owner.coordinationId,
    consentId: owner.consentId,
    draft,
  })
})
it("seals only a sendable original questionnaire for the current recovered owner without constructing a result", async () => {
  expect(await sealRecoveredSurveyDraftAction(draft, "token")).toEqual({
    ok: true,
    sealed: "synthetic-owner-bound-seal",
  })
  expect(mocks.seal).toHaveBeenCalledWith({
    purpose: "recovered-survey",
    coordinationId: owner.coordinationId,
    consentId: owner.consentId,
    draft,
  })
  expect(
    await unsealRecoveredSurveyDraftAction(
      "synthetic-owner-bound-seal",
      "token",
    ),
  ).toEqual({ ok: true, draft })
})
it.each(["authentication", "analysis", "consent", "definition", "answers"])(
  "refuses invalid %s before freezing retries",
  async (incident) => {
    if (incident === "authentication")
      mocks.session.mockResolvedValue({ ...owner, authVerifiedAt: undefined })
    if (incident === "analysis")
      mocks.session.mockResolvedValue({
        ...owner,
        lastCompletedAnalysisId: "other",
      })
    if (incident === "consent")
      mocks.session.mockResolvedValue({ ...owner, consentId: undefined })
    const input = {
      ...draft,
      ...(incident === "definition" ? { definitionId: "changed" } : {}),
      ...(incident === "answers" ? { answers: {} } : {}),
    }
    expect(await sealRecoveredSurveyDraftAction(input, "token")).toMatchObject({
      ok: false,
    })
    expect(mocks.seal).not.toHaveBeenCalled()
  },
)
it.each(["consentId", "coordinationId", "purpose", "analysisId"])(
  "refuses a sealed draft from a different %s",
  async (field) => {
    const envelope = {
      purpose: "recovered-survey",
      consentId: owner.consentId,
      coordinationId: owner.coordinationId,
      draft,
    }
    mocks.unseal.mockResolvedValue(
      field === "analysisId"
        ? { ...envelope, draft: { ...draft, analysisId: "other" } }
        : { ...envelope, [field]: "other" },
    )
    expect(
      await unsealRecoveredSurveyDraftAction(
        "synthetic-owner-bound-seal",
        "token",
      ),
    ).toMatchObject({ ok: false })
  },
)
