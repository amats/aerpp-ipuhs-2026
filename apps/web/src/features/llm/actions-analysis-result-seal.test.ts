import { sealData, unsealData } from "iron-session"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { initialDefinitionId } from "../../../test-support/questionnaires"

const loggerErrorMock = vi.fn()
const getSessionMock = vi.fn()
const readAuthenticationMock = vi.fn()
const isLocallyAuthenticatedMock = vi.fn()
const sealSessionDataMock = vi.fn()
const unsealSessionDataMock = vi.fn()

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
  getSessionForTab: getSessionMock,
}))

vi.mock("@/features/auth/auth-session", () => ({
  readLocalAuthenticationFromSession: readAuthenticationMock,
  isLocallyAuthenticated: isLocallyAuthenticatedMock,
}))

vi.mock("@/lib/session-seal", () => ({
  sealSessionData: sealSessionDataMock,
  unsealSessionData: unsealSessionDataMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: vi.fn(() => ({
    error: loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

const owner = {
  authVerifiedAt: "2026-06-30T00:00:00.000Z",
  clientId: `aerpp:cid-${"c".repeat(32)}`,
  email: "user@example.com",
  pseudonym: `aerpp:pid-${"p".repeat(32)}`,
}

const result = {
  analysisId: `aerpp:aid-${"a".repeat(32)}`,
  documentCount: 1,
  documentGraphemeCount: 10,
  analysisWorkspaceVersion: "1.0.0",
  modelName: "test-model",
  processingDurationSeconds: 2,
  resultGraphemeCount: 5,
  text: "result",
}

describe("result storage actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sealSessionDataMock.mockReset()
    unsealSessionDataMock.mockReset()
    getSessionMock.mockResolvedValue({ consentId: "test-consent" })
    readAuthenticationMock.mockResolvedValue(owner)
    isLocallyAuthenticatedMock.mockReturnValue(true)
  })

  it.each([false, undefined, null, "false", "true", 1, {}, []])(
    "rejects an unconfirmed authentication decision %j before result encryption or decryption",
    async (decision) => {
      isLocallyAuthenticatedMock.mockReturnValue(decision)
      const { sealAnalysisResultAction, unsealAnalysisResultAction } =
        await import("./actions-analysis-result-seal")
      expect(await sealAnalysisResultAction(result)).toBeNull()
      expect(await unsealAnalysisResultAction("sealed")).toEqual({
        ok: true,
        result: null,
      })
      expect(sealSessionDataMock).not.toHaveBeenCalled()
      expect(unsealSessionDataMock).not.toHaveBeenCalled()
    },
  )

  it("checks the definition and encrypts valid answers in one action", async () => {
    const { surveyQuestionSets } = await import(
      "@/features/survey/survey-question-sets"
    )
    const answers: Record<string, string> = {}
    for (const question of surveyQuestionSets.initialSurveyQuestionSet
      .questions) {
      if (question.required !== true || question.type === "section") continue
      answers[question.id] =
        question.type === "text" ? "feedback" : question.options[0]
    }
    getSessionMock.mockResolvedValue({
      consentId: "test-consent",
      stage: "authenticated",
    })
    sealSessionDataMock.mockResolvedValue("sealed")
    const { sealSurveyResultAction } = await import(
      "./actions-analysis-result-seal"
    )
    const prepared = {
      ...result,
      pendingSurveyAnswer: answers,
      pendingQuestionnaireId: initialDefinitionId,
    }
    expect(await sealSurveyResultAction(prepared)).toEqual({
      ok: true,
      sealedResult: "sealed",
    })
    expect(getSessionMock).toHaveBeenCalledOnce()
    expect(sealSessionDataMock).toHaveBeenCalledWith({
      ownerClientId: owner.clientId,
      ownerPseudonym: owner.pseudonym,
      result: prepared,
    })
    sealSessionDataMock.mockClear()
    expect(
      await sealSurveyResultAction({
        ...prepared,
        pendingQuestionnaireId: `jcs-v1:sha256:${"b".repeat(64)}`,
      }),
    ).toEqual({ ok: false, reason: "questionnaire_changed" })
    expect(sealSessionDataMock).not.toHaveBeenCalled()
    sealSessionDataMock.mockRejectedValueOnce(
      new Error("encryption unavailable"),
    )
    expect(await sealSurveyResultAction(prepared)).toEqual({
      ok: false,
      reason: "write_failed",
    })
    expect(
      await sealSurveyResultAction({
        ...prepared,
        pendingSurveyAnswer: { unknown: "invalid" },
      }),
    ).toEqual({ ok: false, reason: "write_failed" })
  })

  it.each(["session-failure", "no-owner"])(
    "does not treat unavailable survey preparation as a mismatch: %s",
    async (failure) => {
      if (failure === "session-failure")
        getSessionMock.mockRejectedValueOnce(new Error("session unavailable"))
      else isLocallyAuthenticatedMock.mockReturnValueOnce(false)
      const { sealSurveyResultAction } = await import(
        "./actions-analysis-result-seal"
      )
      expect(
        await sealSurveyResultAction({
          ...result,
          pendingSurveyAnswer: {},
          pendingQuestionnaireId: initialDefinitionId,
        }),
      ).toEqual({ ok: false, reason: "questionnaire_check_failed" })
      expect(sealSessionDataMock).not.toHaveBeenCalled()
    },
  )

  it("binds encrypted results to the authenticated owner", async () => {
    sealSessionDataMock.mockResolvedValue("sealed-result")
    const { sealAnalysisResultAction } = await import(
      "./actions-analysis-result-seal"
    )

    await expect(sealAnalysisResultAction(result)).resolves.toBe(
      "sealed-result",
    )
    expect(sealSessionDataMock).toHaveBeenCalledWith({
      ownerClientId: owner.clientId,
      ownerPseudonym: owner.pseudonym,
      result,
    })
  })

  it.each([1_000_000, 1_100_000])(
    "does not claim to save a result that exceeds the sealed read limit (%i characters)",
    async (characters) => {
      const options = {
        password: "synthetic-round-trip-test-key-at-least-32-characters",
        ttl: 3600,
      }
      sealSessionDataMock.mockImplementationOnce((data) =>
        sealData(data, options),
      )
      const { unsealAnalysisResultAction, sealAnalysisResultAction } =
        await import("./actions-analysis-result-seal")
      const largeResult = { ...result, text: "x".repeat(characters) }
      const sealed = await sealAnalysisResultAction(largeResult)
      expect(sealed !== null).toBe(characters === 1_000_000)
      if (sealed !== null) {
        unsealSessionDataMock.mockImplementationOnce((value) =>
          unsealData(value, options),
        )
        const restored = await unsealAnalysisResultAction(sealed)
        expect(restored.ok && restored.result?.text.length === characters).toBe(
          true,
        )
      }
    },
  )

  it("decrypts a result only for its authenticated owner", async () => {
    unsealSessionDataMock.mockResolvedValue({
      ownerClientId: owner.clientId,
      ownerPseudonym: owner.pseudonym,
      result,
    })
    const { unsealAnalysisResultAction } = await import(
      "./actions-analysis-result-seal"
    )

    await expect(unsealAnalysisResultAction("sealed-result")).resolves.toEqual({
      ok: true,
      result,
    })

    unsealSessionDataMock.mockResolvedValue({
      ownerClientId: `aerpp:cid-${"x".repeat(32)}`,
      ownerPseudonym: owner.pseudonym,
      result,
    })
    await expect(unsealAnalysisResultAction("sealed-result")).resolves.toEqual({
      ok: true,
      result: null,
    })
  })

  it.each(["matching", "other-analysis", "not-submitted"])(
    "marks only the session-confirmed submitted result for cleanup: %s",
    async (state) => {
      getSessionMock.mockResolvedValue({
        consentId: "test-consent",
        stage: "follow_up",
        rootStep: state === "not-submitted" ? "result" : "thanks",
        submittedAnalysisId:
          state === "not-submitted"
            ? undefined
            : state === "other-analysis"
              ? `aerpp:aid-${"b".repeat(32)}`
              : result.analysisId,
      })
      unsealSessionDataMock.mockResolvedValue({
        ownerClientId: owner.clientId,
        ownerPseudonym: owner.pseudonym,
        result,
      })
      const { unsealAnalysisResultAction } = await import(
        "./actions-analysis-result-seal"
      )
      expect(await unsealAnalysisResultAction("sealed-result")).toEqual({
        ok: true,
        result,
        ...(state === "matching" ? { surveySubmitted: true } : {}),
      })
    },
  )

  it("reports session read failures as unavailable instead of invalid stored data", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("session unavailable"))
    const { unsealAnalysisResultAction } = await import(
      "./actions-analysis-result-seal"
    )
    await expect(unsealAnalysisResultAction("sealed-result")).resolves.toEqual({
      ok: false,
    })
    expect(unsealSessionDataMock).not.toHaveBeenCalled()
  })

  it("does not call the encryption boundary without local authentication", async () => {
    isLocallyAuthenticatedMock.mockReturnValue(false)
    const { unsealAnalysisResultAction, sealAnalysisResultAction } =
      await import("./actions-analysis-result-seal")

    await expect(sealAnalysisResultAction(result)).resolves.toBeNull()
    await expect(unsealAnalysisResultAction("sealed-result")).resolves.toEqual({
      ok: true,
      result: null,
    })
    expect(sealSessionDataMock).not.toHaveBeenCalled()
    expect(unsealSessionDataMock).not.toHaveBeenCalled()
  })

  it("does not freeze invalid answers that must remain editable", async () => {
    const { sealAnalysisResultAction } = await import(
      "./actions-analysis-result-seal"
    )
    expect(
      await sealAnalysisResultAction({
        ...result,
        pendingQuestionnaireId: initialDefinitionId,
        pendingSurveyAnswer: { unknown: "invalid" },
      }),
    ).toBeNull()
    expect(sealSessionDataMock).not.toHaveBeenCalled()
  })

  it.each(["あ", "👨‍👩‍👧‍👦", "e\u0301", " "])(
    "freezes text answers only within the 4,000-character limit, counting %j as one character",
    async (character) => {
      const { surveyQuestionSets } = await import(
        "@/features/survey/survey-question-sets"
      )
      const { Stage } = await import("@/features/app-context/stage-types")
      getSessionMock.mockResolvedValue({
        consentId: "test-consent",
        stage: Stage.authenticated,
      })
      const questions = surveyQuestionSets.initialSurveyQuestionSet.questions
      const answers: Record<string, string> = {}
      for (const question of questions) {
        if (!question.required || question.type === "section") continue
        answers[question.id] =
          question.type === "text" ? "feedback" : question.options[0]
      }
      const freeText = questions.find(
        (question) => question.type === "text" && !question.required,
      )
      expect(freeText).toBeDefined()
      const answerId = freeText?.id as string
      const { sealAnalysisResultAction } = await import(
        "./actions-analysis-result-seal"
      )
      expect(
        await sealAnalysisResultAction({
          ...result,
          pendingQuestionnaireId: initialDefinitionId,
          pendingSurveyAnswer: {
            ...answers,
            [answerId]: character.repeat(4001),
          },
        }),
      ).toBeNull()
      expect(sealSessionDataMock).not.toHaveBeenCalled()
      sealSessionDataMock.mockResolvedValue("sealed")
      expect(
        await sealAnalysisResultAction({
          ...result,
          pendingQuestionnaireId: initialDefinitionId,
          pendingSurveyAnswer: {
            ...answers,
            [answerId]: character.repeat(4000),
          },
        }),
      ).toBe("sealed")
    },
  )

  it("preserves valid frozen answers through owner-bound encryption and decryption", async () => {
    const { surveyQuestionSets } = await import(
      "@/features/survey/survey-question-sets"
    )
    const { Stage } = await import("@/features/app-context/stage-types")
    getSessionMock.mockResolvedValue({
      consentId: "test-consent",
      stage: Stage.authenticated,
    })
    const answers: Record<string, string> = {}
    for (const question of surveyQuestionSets.initialSurveyQuestionSet
      .questions) {
      if (!question.required || question.type === "section") continue
      answers[question.id] =
        question.type === "text" ? "feedback" : question.options[0]
    }
    sealSessionDataMock.mockResolvedValue("sealed")
    const prepared = {
      ...result,
      pendingQuestionnaireId: initialDefinitionId,
      pendingSurveyAnswer: answers,
    }
    const { sealAnalysisResultAction, unsealAnalysisResultAction } =
      await import("./actions-analysis-result-seal")
    expect(await sealAnalysisResultAction(prepared)).toBe("sealed")
    const envelope = sealSessionDataMock.mock.calls[0][0]
    expect(envelope.result.pendingSurveyAnswer).toEqual(answers)
    unsealSessionDataMock.mockResolvedValue(envelope)
    expect(await unsealAnalysisResultAction("sealed")).toEqual({
      ok: true,
      result: prepared,
    })
  })
})

it.each(["\\", "\u0001", '"', "日本語", "😀"])(
  "round-trips accepted output and frozen survey retries with JSON-sensitive text %j",
  async (character) => {
    const { ANALYSIS_JOB_CONSTRAINTS } = await import(
      "./analysis-job-constraints"
    )
    const { BROWSER_PAYLOAD_CONSTRAINTS } = await import(
      "@/lib/browser-payload-constraints.mjs"
    )
    const { surveyQuestionSets } = await import(
      "@/features/survey/survey-question-sets"
    )
    const { Stage } = await import("@/features/app-context/stage-types")
    const { sealSurveyResultAction, unsealAnalysisResultAction } = await import(
      "./actions-analysis-result-seal"
    )
    getSessionMock.mockResolvedValue({
      consentId: "test-consent",
      stage: Stage.authenticated,
    })
    readAuthenticationMock.mockResolvedValue(owner)
    isLocallyAuthenticatedMock.mockReturnValue(true)
    const options = {
      password: "synthetic-result-size-test-password-at-least-32",
      ttl: 0,
    }
    sealSessionDataMock.mockImplementation((data) => sealData(data, options))
    unsealSessionDataMock.mockImplementation((value) =>
      unsealData(value, options),
    )
    const answers: Record<string, string> = {}
    for (const question of surveyQuestionSets.initialSurveyQuestionSet
      .questions) {
      if (question.type === "section") continue
      answers[question.id] =
        question.type === "text"
          ? `e${"\u0301".repeat(20)}`.repeat(4000)
          : question.options[0]
    }
    // Keep a near-limit free-text response in one question; other text inputs are small.
    const textIds = surveyQuestionSets.initialSurveyQuestionSet.questions
      .filter((question) => question.type === "text")
      .map((question) => question.id)
    for (const id of textIds.slice(1)) answers[id] = "feedback"
    const text = character.repeat(
      Math.floor(
        ANALYSIS_JOB_CONSTRAINTS.maxResultBytes /
          new TextEncoder().encode(character).byteLength,
      ),
    )
    const prepared = {
      ...result,
      text,
      pendingQuestionnaireId: initialDefinitionId,
      pendingSurveyAnswer: answers,
    }
    const sealed = await sealSurveyResultAction(prepared)
    expect(sealed.ok).toBe(true)
    if (sealed.ok !== true) throw new Error("Expected a saved synthetic result")
    expect(sealed.sealedResult.length).toBeLessThanOrEqual(
      BROWSER_PAYLOAD_CONSTRAINTS.maxSealedCharacters,
    )
    expect(
      new TextEncoder().encode(
        JSON.stringify([sealed.sealedResult, "synthetic-token"]),
      ).byteLength + 20_000,
    ).toBeLessThan(BROWSER_PAYLOAD_CONSTRAINTS.maxActionBodyBytes)
    expect(await unsealAnalysisResultAction(sealed.sealedResult)).toEqual({
      ok: true,
      result: prepared,
    })
  },
)
