import { SurveyAnswerFieldNameSchema } from "@aerpp/participant-api-contracts/participant-api"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import type { AnalysisCompletionMetadata } from "@/features/llm/analysis-completion-types"
import { surveyQuestionSets } from "@/features/survey/survey-question-sets"
import type { SurveyQuestionSet } from "@/features/survey/survey-question-types"
import {
  followUpDefinitionId,
  initialDefinitionId,
} from "../../../test-support/questionnaires"

const headersMock = vi.fn()
const readStageMock = vi.fn()
const readStepStateMock = vi.fn()
const getSessionMock = vi.fn()
const createClientIdMock = vi.fn()
const getClientIdMock = vi.fn()
const getPseudonymMock = vi.fn()
const fetchWithRetryMock = vi.fn()
const loggerMock = {
  child: vi.fn(() => loggerMock),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}
const createLoggerMock = vi.fn(() => loggerMock)
const getRequestContextFromHeadersMock = vi.fn(() => ({}))

const metadata: AnalysisCompletionMetadata = {
  analysisId: `aerpp:aid-${"a".repeat(32)}`,
  analysisWorkspaceVersion: "1.0.0",
  modelName: "test-model",
  processingDurationSeconds: 12,
  documentCount: 2,
  documentGraphemeCount: 345,
  resultGraphemeCount: 678,
}

function createValidSurveyAnswer(questionSet: SurveyQuestionSet) {
  const answer: Record<string, string> = {}
  for (const question of questionSet.questions) {
    if (!question.required || question.type === "section") {
      continue
    }
    if (question.type === "text") {
      answer[question.id] = "自由記述の回答"
    } else {
      answer[question.id] = question.options[0] ?? ""
    }
  }
  return answer
}

function getFirstRequiredAnswerId(questionSet: SurveyQuestionSet) {
  const question = questionSet.questions.find(
    (item) => item.required && item.type !== "section",
  )
  if (!question) {
    throw new Error("Expected at least one required survey question")
  }
  return question.id
}

function getFirstChoiceQuestion(questionSet: SurveyQuestionSet) {
  const question = questionSet.questions.find(
    (item) => item.type === "single_choice" || item.type === "likert7",
  )
  if (!question) {
    throw new Error("Expected at least one choice survey question")
  }
  return question
}

function createSurveySession({
  stage = Stage.authenticated,
  rootStep = RootStep.survey,
}: {
  stage?: Stage
  rootStep?: RootStep
} = {}) {
  return {
    consentId: "synthetic-consent",
    stage,
    rootStep,
    lastCompletedAnalysisId: metadata.analysisId,
  } as never
}

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

vi.mock("@/features/app-context/step-state-session", () => ({
  readStageFromSession: readStageMock,
  readStepStateFromSession: readStepStateMock,
}))

vi.mock("@/features/identity/participant-identifiers", () => ({
  createClientId: createClientIdMock,
  readClientIdFromSession: getClientIdMock,
  readPseudonymFromSession: getPseudonymMock,
}))

vi.mock("@aerpp/config/server/web", () => ({
  env: {
    receptionExpiresAt: new Date("2099-01-01T00:00:00Z"),
    participantApiServerId: "server-id",
    supportApiCredential: "magic-key",
    recordAnalysisCompletionUrl: "https://example.com/analysis-completion",
    submitSurveyUrl: "https://example.com/survey",
  },
}))

vi.mock("@/lib/fetch-with-retry", () => ({
  fetchWithRetry: fetchWithRetryMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: createLoggerMock,
  getRequestContextFromHeaders: getRequestContextFromHeadersMock,
}))

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
}))

describe("survey-service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue("psn_123")
    readStageMock.mockImplementation((session) => session.stage)
    readStepStateMock.mockImplementation((session) => ({
      stage: session.stage,
      step: session.rootStep ?? RootStep.result,
    }))
  })

  it("recordAnalysisCompletion rejects when the session stage is not authenticated", async () => {
    const session = {
      consentId: "synthetic-consent",
      stage: Stage.confirmationSent,
    } as never

    const { recordAnalysisCompletion } = await import("./survey-service")

    const result = await recordAnalysisCompletion(session, metadata)

    expect(result).toBe(false)
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("recordAnalysisCompletion rejects outside the result step", async () => {
    const session = {
      consentId: "synthetic-consent",
      stage: Stage.authenticated,
      rootStep: RootStep.survey,
    } as never

    const { recordAnalysisCompletion } = await import("./survey-service")

    const result = await recordAnalysisCompletion(session, metadata)

    expect(result).toBe(false)
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("recordAnalysisCompletion rejects when identifiers are unavailable", async () => {
    const session = {
      consentId: "synthetic-consent",
      stage: Stage.authenticated,
    } as never
    getClientIdMock.mockResolvedValue(null)
    getPseudonymMock.mockResolvedValue("psn_123")

    const { recordAnalysisCompletion } = await import("./survey-service")

    const result = await recordAnalysisCompletion(session, metadata)

    expect(result).toBe(false)
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("recordAnalysisCompletion rejects when analysisId is missing", async () => {
    const session = {
      consentId: "synthetic-consent",
      stage: Stage.authenticated,
    } as never

    const { recordAnalysisCompletion } = await import("./survey-service")

    const result = await recordAnalysisCompletion(session, {
      ...metadata,
      analysisId: "",
    })

    expect(result).toBe(false)
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("recordAnalysisCompletion rejects invalid metadata payloads", async () => {
    const session = {
      consentId: "synthetic-consent",
      stage: Stage.authenticated,
    } as never

    const { recordAnalysisCompletion } = await import("./survey-service")

    await expect(recordAnalysisCompletion(session, null)).resolves.toBe(false)
    await expect(
      recordAnalysisCompletion(session, {
        ...metadata,
        documentCount: -1,
      }),
    ).resolves.toBe(false)

    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("recordAnalysisCompletion posts the expected payload and returns true on success", async () => {
    const session = {
      consentId: "synthetic-consent",
      stage: Stage.authenticated,
    } as never
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue("psn_123")
    fetchWithRetryMock.mockResolvedValue(Response.json({ ok: true }))

    const { recordAnalysisCompletion } = await import("./survey-service")

    const result = await recordAnalysisCompletion(session, metadata)

    expect(result).toBe(true)
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      "https://example.com/analysis-completion",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          serverId: "server-id",
          clientId: "client_123",
          pseudonym: "psn_123",
          consentId: "synthetic-consent",
          analysisId: metadata.analysisId,
          analysisWorkspaceVersion: "1.0.0",
          modelName: metadata.modelName,
          processingDurationSeconds: 12,
          documentCount: 2,
          documentGraphemeCount: 345,
          resultGraphemeCount: 678,
        }),
      }),
      expect.any(Object),
    )
    const requestInit = fetchWithRetryMock.mock.calls[0]?.[1] as RequestInit
    for (const field of Object.keys(JSON.parse(String(requestInit.body))))
      expect(SurveyAnswerFieldNameSchema.safeParse(field).success).toBe(false)
  })

  it("submitSurvey posts validated answers plus analysisId", async () => {
    fetchWithRetryMock.mockResolvedValue(Response.json({ ok: true }))
    const session = createSurveySession()
    const surveyAnswer = createValidSurveyAnswer(
      surveyQuestionSets.initialSurveyQuestionSet,
    )

    const { submitSurvey } = await import("./survey-service")

    const result = await submitSurvey(
      session,
      surveyAnswer,
      initialDefinitionId,
    )

    expect(result).toEqual({ ok: true })
    expect(fetchWithRetryMock).toHaveBeenCalled()
    const requestInit = fetchWithRetryMock.mock.calls[0]?.[1] as RequestInit
    expect(requestInit.method).toBe("POST")
    expect(JSON.parse(String(requestInit.body))).toEqual({
      answers: Object.fromEntries(
        surveyQuestionSets.initialSurveyQuestionSet.questions
          .filter((q) => q.type !== "section")
          .map((q) => [q.id, surveyAnswer[q.id] ?? null]),
      ),
      questionnaire: { kind: "initial", definitionId: initialDefinitionId },
      consentId: "synthetic-consent",
      serverId: "server-id",
      clientId: "client_123",
      pseudonym: "psn_123",
      analysisId: metadata.analysisId,
    })
  })

  it("submitSurvey accepts completed stage", async () => {
    fetchWithRetryMock.mockResolvedValue(Response.json({ ok: true }))
    const session = createSurveySession({ stage: Stage.followUp })
    const surveyAnswer = createValidSurveyAnswer(
      surveyQuestionSets.followUpSurveyQuestionSet,
    )

    const { submitSurvey } = await import("./survey-service")

    const result = await submitSurvey(
      session,
      surveyAnswer,
      followUpDefinitionId,
    )

    expect(result).toEqual({ ok: true })
    const requestInit = fetchWithRetryMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toEqual({
      answers: Object.fromEntries(
        surveyQuestionSets.followUpSurveyQuestionSet.questions
          .filter((q) => q.type !== "section")
          .map((q) => [q.id, surveyAnswer[q.id] ?? null]),
      ),
      questionnaire: { kind: "follow-up", definitionId: followUpDefinitionId },
      consentId: "synthetic-consent",
      serverId: "server-id",
      clientId: "client_123",
      pseudonym: "psn_123",
      analysisId: metadata.analysisId,
    })
  })

  it.each(["arbitrary-version", "0", "  v1  "])(
    "submits answers while preserving version metadata %j",
    async (version) => {
      const questionSet = surveyQuestionSets.initialSurveyQuestionSet
      const originalVersion = questionSet.version
      questionSet.version = version
      try {
        fetchWithRetryMock.mockResolvedValue(Response.json({ ok: true }))
        const { submitSurvey } = await import("./survey-service")
        expect(
          await submitSurvey(
            createSurveySession(),
            createValidSurveyAnswer(questionSet),
            initialDefinitionId,
          ),
        ).toEqual({ ok: true })
        const body = JSON.parse(
          String(fetchWithRetryMock.mock.calls[0][1].body),
        )
        expect(body.questionnaire.definitionId).toEqual(initialDefinitionId)
      } finally {
        questionSet.version = originalVersion
      }
    },
  )

  it("submitSurvey rejects invalid payload shapes", async () => {
    const session = createSurveySession()
    const { submitSurvey } = await import("./survey-service")

    await expect(
      submitSurvey(session, null, initialDefinitionId),
    ).resolves.toEqual({
      ok: false,
      reason: "submit_failed",
    })
    await expect(
      submitSurvey(
        session,
        {
          [getFirstRequiredAnswerId(
            surveyQuestionSets.initialSurveyQuestionSet,
          )]: 1,
        },
        initialDefinitionId,
      ),
    ).resolves.toEqual({ ok: false, reason: "submit_failed" })
    const sessionWithoutAnalysis = createSurveySession()
    delete (sessionWithoutAnalysis as { lastCompletedAnalysisId?: string })
      .lastCompletedAnalysisId
    await expect(
      submitSurvey(
        sessionWithoutAnalysis,
        createValidSurveyAnswer(surveyQuestionSets.initialSurveyQuestionSet),
        initialDefinitionId,
      ),
    ).resolves.toEqual({ ok: false, reason: "submit_failed" })

    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("submitSurvey rejects unknown survey question ids", async () => {
    const session = createSurveySession()
    const surveyAnswer = {
      ...createValidSurveyAnswer(surveyQuestionSets.initialSurveyQuestionSet),
      unknownQuestion: "answer",
    }

    const { submitSurvey } = await import("./survey-service")

    await expect(
      submitSurvey(session, surveyAnswer, initialDefinitionId),
    ).resolves.toEqual({
      ok: false,
      reason: "submit_failed",
    })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("submitSurvey rejects missing required answers", async () => {
    const session = createSurveySession()
    const surveyAnswer = createValidSurveyAnswer(
      surveyQuestionSets.initialSurveyQuestionSet,
    )
    delete surveyAnswer[
      getFirstRequiredAnswerId(surveyQuestionSets.initialSurveyQuestionSet)
    ]

    const { submitSurvey } = await import("./survey-service")

    await expect(
      submitSurvey(session, surveyAnswer, initialDefinitionId),
    ).resolves.toEqual({
      ok: false,
      reason: "submit_failed",
    })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("submitSurvey rejects choice answers outside the configured options", async () => {
    const session = createSurveySession()
    const surveyAnswer = createValidSurveyAnswer(
      surveyQuestionSets.initialSurveyQuestionSet,
    )
    const choiceQuestion = getFirstChoiceQuestion(
      surveyQuestionSets.initialSurveyQuestionSet,
    )
    surveyAnswer[choiceQuestion.id] = "選択肢にない回答"

    const { submitSurvey } = await import("./survey-service")

    await expect(
      submitSurvey(session, surveyAnswer, initialDefinitionId),
    ).resolves.toEqual({
      ok: false,
      reason: "submit_failed",
    })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("submitSurvey rejects outside completed-result and survey views after validating input", async () => {
    const session = createSurveySession({ rootStep: RootStep.document })
    const surveyAnswer = createValidSurveyAnswer(
      surveyQuestionSets.initialSurveyQuestionSet,
    )

    const { submitSurvey } = await import("./survey-service")

    await expect(
      submitSurvey(session, surveyAnswer, initialDefinitionId),
    ).resolves.toEqual({
      ok: false,
      reason: "submit_failed",
    })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it.each([
    [200, null],
    [200, { ok: false }],
    [200, {}],
    [200, { ok: null }],
    [200, { ok: "false" }],
    [200, { ok: "true" }],
    [200, { ok: 1 }],
    [200, { ok: {} }],
    [200, { ok: [] }],
    [202, { ok: true }],
    [409, { ok: true }],
  ])(
    "rejects unconfirmed answer and metadata saves for %s %j",
    async (status, body) => {
      fetchWithRetryMock.mockImplementation(
        async () =>
          new Response(body === null ? null : JSON.stringify(body), { status }),
      )
      const { submitSurvey, recordAnalysisCompletion } = await import(
        "./survey-service"
      )
      expect(
        await submitSurvey(
          createSurveySession(),
          createValidSurveyAnswer(surveyQuestionSets.initialSurveyQuestionSet),
          initialDefinitionId,
        ),
      ).toEqual({ ok: false, reason: "submit_failed" })
      expect(
        await recordAnalysisCompletion(
          createSurveySession({ rootStep: RootStep.result }),
          metadata,
        ),
      ).toBe(false)
      expect(fetchWithRetryMock).toHaveBeenCalledTimes(2)
    },
  )

  it("rejects answers with missing owner fields before calling the API", async () => {
    getPseudonymMock.mockResolvedValue(null)
    const { submitSurvey } = await import("./survey-service")
    expect(
      (
        await submitSurvey(
          createSurveySession(),
          createValidSurveyAnswer(surveyQuestionSets.initialSurveyQuestionSet),
          initialDefinitionId,
        )
      ).ok,
    ).toBe(false)
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
    expect(createClientIdMock).not.toHaveBeenCalled()
  })
})
