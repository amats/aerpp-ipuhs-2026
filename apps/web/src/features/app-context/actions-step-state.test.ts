import { beforeEach, describe, expect, it, vi } from "vitest"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"
import { createPseudonym } from "@/features/identity/participant-identifiers"
import { initialDefinitionId } from "../../../test-support/questionnaires"

const {
  getSessionMock,
  readExecutionMock,
  cancelJobMock,
  readJobStatusMock,
  recordUnavailableMock,
  sessionSaveMock,
  sendMagicLinkEmailMock,
  prepareConsentForEmailMock,
  verifyAuthenticationMock,
  withdrawParticipationMock,
  submitSurveyMock,
  loggerMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  readExecutionMock: vi.fn(),
  cancelJobMock: vi.fn(),
  readJobStatusMock: vi.fn(),
  recordUnavailableMock: vi.fn(async () => true),
  sessionSaveMock: vi.fn(),
  sendMagicLinkEmailMock: vi.fn(),
  prepareConsentForEmailMock: vi.fn(),
  verifyAuthenticationMock: vi.fn(),
  withdrawParticipationMock: vi.fn(),
  submitSurveyMock: vi.fn(),
  loggerMock: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/features/llm/analysis-attempt", () => ({
  recordUnavailableAnalysis: recordUnavailableMock,
}))

vi.mock("@/features/llm/analysis-job-access", () => ({
  readAnalysisJobStatusFromSession: readJobStatusMock,
  cancelAnalysisJobFromSession: cancelJobMock,
}))

vi.mock("@/lib/session-authority", () => ({
  readAnalysisOperation: readExecutionMock,
}))

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: vi.fn(() => loggerMock),
  getRequestContextFromHeaders: vi.fn(() => ({})),
}))

vi.mock("@/features/auth/auth-service", () => ({
  sendMagicLinkEmail: sendMagicLinkEmailMock,
  prepareConsentForEmail: prepareConsentForEmailMock,
  verifyAuthentication: verifyAuthenticationMock,
  withdrawParticipation: withdrawParticipationMock,
}))

vi.mock("@/features/survey/survey-service", () => ({
  submitSurvey: submitSurveyMock,
}))

function createAuthenticatedSession({
  authVerifiedAt = "2026-04-28T00:00:00.000Z",
  clientId = `aerpp:cid-${"x".repeat(32)}`,
  email = "user@example.com",
  pseudonym = createPseudonym(email),
  rootStep = RootStep.document,
  stage = Stage.authenticated,
}: {
  authVerifiedAt?: string
  clientId?: string
  email?: string
  pseudonym?: string | null
  rootStep?: RootStep
  stage?: Stage
} = {}) {
  return {
    authVerifiedAt,
    clientId,
    email,
    pseudonym,
    rootStep,
    save: sessionSaveMock,
    stage,
    questionnaireKind: stage === Stage.followUp ? "follow-up" : "initial",
  }
}

describe("actions-step-state", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readExecutionMock.mockReset().mockReturnValue(null)
    sendMagicLinkEmailMock.mockResolvedValue({ ok: true })
    withdrawParticipationMock.mockResolvedValue({ ok: true })
    submitSurveyMock.mockResolvedValue({ ok: true })
    sessionSaveMock.mockReset().mockResolvedValue(true)
    verifyAuthenticationMock.mockImplementation(async (session) => {
      session.authVerifiedAt = "2026-04-28T01:02:03.000Z"
      session.questionnaireKind ??= "initial"
      return {
        ok: true,
        authVerifiedAt: "2026-04-28T01:02:03.000Z",
      }
    })
  })

  it("does not expose a generic step-state save action", async () => {
    const actions = await import("./actions-step-state")

    expect("saveStepStateAction" in actions).toBe(false)
  })

  it("returns pending authentication to consent and clears its old identity", async () => {
    const session = {
      ...createAuthenticatedSession({
        stage: Stage.confirmationSent,
        rootStep: RootStep.auth,
      }),
      consentId: "old-consent",
      preparedConsentContext: "old-context",
      lastConsentMailAt: 42,
    }
    getSessionMock.mockResolvedValue(session)
    const { correctConsentEmailAction } = await import("./actions-step-state")
    expect(await correctConsentEmailAction()).toEqual({
      ok: true,
      stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
    })
    for (const field of [
      "email",
      "preparedConsentContext",
      "consentId",
      "clientId",
      "pseudonym",
      "authVerifiedAt",
    ])
      expect(session).not.toHaveProperty(field)
    expect(session.lastConsentMailAt).toBe(42)
  })

  it.each([Stage.authenticated, Stage.followUp, Stage.withdrawn])(
    "rejects email correction after %s without changing state",
    async (stage) => {
      const session = createAuthenticatedSession({ stage })
      getSessionMock.mockResolvedValue(session)
      const { correctConsentEmailAction } = await import("./actions-step-state")
      expect(await correctConsentEmailAction()).toMatchObject({ ok: false })
      expect(sessionSaveMock).not.toHaveBeenCalled()
    },
  )

  it.each(["correctConsentEmailAction", "resetFlowAction"] as const)(
    "preserves recovery consent during %s unless authentication is confirmed expired",
    async (action) => {
      const actions = await import("./actions-step-state")
      for (const outcome of [
        { ok: true, authVerifiedAt: "2026-04-28T01:02:03.000Z" },
        { ok: false, reason: "not_verified" },
        { ok: false, reason: "auth_unavailable" },
        { ok: false, reason: "auth_expired" },
      ]) {
        sessionSaveMock.mockClear()
        const session = {
          ...createAuthenticatedSession({
            stage: Stage.confirmationSent,
            rootStep: RootStep.auth,
          }),
          adminRecoveryId: "22222222-2222-4222-8222-222222222222",
          consentId: "recovery-consent",
          preparedConsentContext: "recovery-context",
        }
        getSessionMock.mockResolvedValue(session)
        verifyAuthenticationMock.mockResolvedValueOnce(outcome)
        const result = await actions[action]()
        if (outcome.reason === "auth_expired") {
          expect(result.ok).toBe(true)
          expect(sessionSaveMock).toHaveBeenCalledOnce()
        } else {
          expect(result).toMatchObject({
            ok: false,
            reason: "recovery_authentication_required",
          })
          expect(session).toMatchObject({
            consentId: "recovery-consent",
            preparedConsentContext: "recovery-context",
            stage: Stage.confirmationSent,
          })
          expect(sessionSaveMock).not.toHaveBeenCalled()
        }
      }
    },
  )

  it.each([
    {
      actionName: "moveToConsentAction" as const,
      current: {
        stage: Stage.unauthenticated,
        rootStep: RootStep.explanation,
      },
      next: { stage: Stage.unauthenticated, step: RootStep.consent },
    },
    {
      actionName: "startAnalysisAction" as const,
      current: {
        stage: Stage.authenticated,
        rootStep: RootStep.document,
      },
      next: { stage: Stage.authenticated, step: RootStep.result },
    },
    {
      actionName: "cancelAnalysisAction" as const,
      current: {
        stage: Stage.authenticated,
        rootStep: RootStep.result,
      },
      next: { stage: Stage.authenticated, step: RootStep.document },
    },
    {
      actionName: "failAnalysisAction" as const,
      current: {
        stage: Stage.authenticated,
        rootStep: RootStep.result,
      },
      next: { stage: Stage.authenticated, step: RootStep.document },
    },
    {
      actionName: "returnToResultAction" as const,
      current: {
        stage: Stage.authenticated,
        rootStep: RootStep.survey,
      },
      next: { stage: Stage.authenticated, step: RootStep.result },
    },
  ])(
    "$actionName follows the declared direct transition",
    async ({ actionName, current, next }) => {
      const session =
        current.stage === Stage.unauthenticated
          ? { ...current, save: sessionSaveMock }
          : createAuthenticatedSession(current)
      getSessionMock.mockResolvedValue(session)
      const actions = await import("./actions-step-state")

      const result = await actions[actionName]()

      expect(result).toEqual({ ok: true, stepState: next })
      expect(session.stage).toBe(next.stage)
      expect(session.rootStep).toBe(
        ["returnToResultAction", "moveToConsentAction"].includes(actionName)
          ? current.rootStep
          : next.step,
      )
      expect(sessionSaveMock).toHaveBeenCalledTimes(
        ["returnToResultAction", "moveToConsentAction"].includes(actionName)
          ? 0
          : 1,
      )
    },
  )

  it("moves to explanation by deriving the next step state on the server", async () => {
    const session = {
      stage: Stage.unauthenticated,
      rootStep: RootStep.start,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)

    const { moveToExplanationAction } = await import("./actions-step-state")

    const result = await moveToExplanationAction()

    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.unauthenticated,
        step: RootStep.explanation,
      },
    })
    expect(session.stage).toBe(Stage.unauthenticated)
    expect(session.rootStep).toBe(RootStep.start)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("navigates intro views without writing shared business state", async () => {
    const session = {
      stage: Stage.unauthenticated,
      rootStep: RootStep.start,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)
    const {
      moveToConsentAction,
      moveToOverviewAction,
      moveToExplanationAction,
    } = await import("./actions-step-state")
    for (const action of [
      moveToConsentAction,
      moveToOverviewAction,
      moveToExplanationAction,
    ]) {
      expect((await action()).ok).toBe(true)
      expect(session.rootStep).toBe(RootStep.start)
    }
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("does not move from withdrawn state back into the pre-consent flow", async () => {
    const session = {
      stage: Stage.withdrawn,
      rootStep: RootStep.withdrawn,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)

    const { moveToExplanationAction } = await import("./actions-step-state")

    const result = await moveToExplanationAction()

    expect(result).toEqual({ ok: false, reason: "stage_mismatch" })
    expect(session.stage).toBe(Stage.withdrawn)
    expect(session.rootStep).toBe(RootStep.withdrawn)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("sends consent email before moving to auth and clears stale auth proof", async () => {
    const session = {
      authVerifiedAt: "2026-04-27T00:00:00.000Z",
      stage: Stage.unauthenticated,
      rootStep: RootStep.consent,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)

    const { sendConsentEmailAndMoveToAuthAction } = await import(
      "./actions-step-state"
    )

    const result = await sendConsentEmailAndMoveToAuthAction("user@example.com")

    expect(sendMagicLinkEmailMock).toHaveBeenCalledWith(
      session,
      "user@example.com",
      undefined,
    )
    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.confirmationSent,
        step: RootStep.auth,
      },
    })
    expect(session.stage).toBe(Stage.confirmationSent)
    expect(session.rootStep).toBe(RootStep.auth)
    expect(session.authVerifiedAt).toBeUndefined()
  })

  it("does not send consent email from withdrawn stage", async () => {
    const session = {
      stage: Stage.withdrawn,
      rootStep: RootStep.consent,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)

    const { sendConsentEmailAndMoveToAuthAction } = await import(
      "./actions-step-state"
    )

    const result = await sendConsentEmailAndMoveToAuthAction("user@example.com")

    expect(result).toEqual({ ok: false, reason: "stage_mismatch" })
    expect(sendMagicLinkEmailMock).not.toHaveBeenCalled()
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("does not save session changes when consent email sending fails", async () => {
    const session: {
      email?: string
      rootStep: RootStep
      save: typeof sessionSaveMock
      stage: Stage
    } = {
      stage: Stage.unauthenticated,
      rootStep: RootStep.consent,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)
    sendMagicLinkEmailMock.mockImplementationOnce(async (appSession) => {
      appSession.email = "user@example.com"
      return { ok: false, reason: "send_failed" }
    })

    const { sendConsentEmailAndMoveToAuthAction } = await import(
      "./actions-step-state"
    )

    const result = await sendConsentEmailAndMoveToAuthAction("user@example.com")

    expect(result).toEqual({ ok: false, reason: "send_failed" })
    expect(session.email).toBe("user@example.com")
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("prepares analysis only when local authentication proof is valid", async () => {
    const session = createAuthenticatedSession({ rootStep: RootStep.result })
    getSessionMock.mockResolvedValue(session)

    const { prepareNewAnalysisAction } = await import("./actions-step-state")

    const result = await prepareNewAnalysisAction()

    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.authenticated,
        step: RootStep.document,
      },
    })
    expect(sessionSaveMock).toHaveBeenCalledTimes(1)
  })

  it("prepares follow-up documents from accepted Thanks without a browser result", async () => {
    const id = `aerpp:aid-${"a".repeat(32)}`
    const session = {
      ...createAuthenticatedSession({
        stage: Stage.followUp,
        rootStep: RootStep.thanks,
      }),
      lastCompletedAnalysisId: id,
      submittedAnalysisId: id,
    }
    getSessionMock.mockResolvedValue(session)
    const { prepareNewAnalysisAction } = await import("./actions-step-state")
    expect(await prepareNewAnalysisAction(null)).toEqual({
      ok: true,
      stepState: { stage: Stage.followUp, step: RootStep.document },
    })
    expect(sessionSaveMock).toHaveBeenCalledOnce()
    expect(session.lastCompletedAnalysisId).toBeUndefined()
    expect(session.submittedAnalysisId).toBeUndefined()
    expect(submitSurveyMock).not.toHaveBeenCalled()
    expect(verifyAuthenticationMock).not.toHaveBeenCalled()
  })

  it.each([
    ["missing acceptance", { submittedAnalysisId: undefined }],
    [
      "different acceptance",
      { submittedAnalysisId: `aerpp:aid-${"b".repeat(32)}` },
    ],
    [
      "missing receipt",
      { lastCompletedAnalysisId: undefined, submittedAnalysisId: undefined },
    ],
    [
      "malformed receipt",
      { lastCompletedAnalysisId: "invalid", submittedAnalysisId: "invalid" },
    ],
    ["result view", { rootStep: RootStep.result }],
    ["survey view", { rootStep: RootStep.survey }],
    [
      "initial flow",
      {
        stage: Stage.authenticated,
        rootStep: RootStep.survey,
        questionnaireKind: "initial",
      },
    ],
  ])("refuses result-less preparation with %s", async (_name, overrides) => {
    const id = `aerpp:aid-${"a".repeat(32)}`
    const session = {
      ...createAuthenticatedSession({
        stage: Stage.followUp,
        rootStep: RootStep.thanks,
      }),
      lastCompletedAnalysisId: id,
      submittedAnalysisId: id,
      ...overrides,
    }
    const original = { ...session }
    getSessionMock.mockResolvedValue(session)
    const { prepareNewAnalysisAction } = await import("./actions-step-state")
    expect(await prepareNewAnalysisAction(null)).toEqual({
      ok: false,
      reason: "analysis_mismatch",
    })
    expect(session).toEqual(original)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it.each([
    [
      "pending answer",
      { pendingSurveyAnalysisId: `aerpp:aid-${"b".repeat(32)}` },
      null,
      "submission_pending",
    ],
    ["missing authentication", { authVerifiedAt: "" }, null, "auth_mismatch"],
    [
      "running analysis",
      {
        activeAnalysisId: `aerpp:aid-${"b".repeat(32)}`,
        coordinationId: "session",
      },
      "running",
      "analysis_in_progress",
    ],
    [
      "unknown analysis",
      {
        activeAnalysisId: `aerpp:aid-${"b".repeat(32)}`,
        coordinationId: "session",
      },
      null,
      "analysis_unconfirmed",
    ],
  ])(
    "protects %s during result-less accepted-survey preparation",
    async (_name, overrides, execution, reason) => {
      const id = `aerpp:aid-${"a".repeat(32)}`
      const session = {
        ...createAuthenticatedSession({
          stage: Stage.followUp,
          rootStep: RootStep.thanks,
        }),
        lastCompletedAnalysisId: id,
        submittedAnalysisId: id,
        ...overrides,
      }
      const original = { ...session }
      getSessionMock.mockResolvedValue(session)
      readExecutionMock.mockReturnValue(execution)
      const { prepareNewAnalysisAction } = await import("./actions-step-state")
      expect(await prepareNewAnalysisAction(null)).toEqual({
        ok: false,
        reason,
      })
      expect(session).toEqual(original)
      expect(sessionSaveMock).not.toHaveBeenCalled()
    },
  )

  it.each(["initial", "follow-up"])(
    "prepares %s from the verified mode without a count request",
    async (kind) => {
      const session = {
        ...createAuthenticatedSession({ rootStep: RootStep.result }),
        questionnaireKind: kind,
      }
      getSessionMock.mockResolvedValue(session)
      const { prepareNewAnalysisAction } = await import("./actions-step-state")
      expect(await prepareNewAnalysisAction()).toEqual({
        ok: true,
        stepState: {
          stage: kind === "initial" ? Stage.authenticated : Stage.followUp,
          step: RootStep.document,
        },
      })
      expect(verifyAuthenticationMock).not.toHaveBeenCalled()
    },
  )

  it("does not prepare a new analysis from the document step", async () => {
    const session = createAuthenticatedSession({ rootStep: RootStep.document })
    getSessionMock.mockResolvedValue(session)

    const { prepareNewAnalysisAction } = await import("./actions-step-state")

    const result = await prepareNewAnalysisAction()

    expect(result).toEqual({ ok: false, reason: "stage_mismatch" })
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it.each([
    ["missing auth proof", { authVerifiedAt: "" }],
    ["invalid email", { email: "not-an-email" }],
    ["missing client id", { clientId: "" }],
    ["pseudonym mismatch", { pseudonym: "aerpp:pid-mismatch" }],
  ])("rejects authenticated transitions with %s", async (_name, overrides) => {
    const session = createAuthenticatedSession({
      rootStep: RootStep.result,
      ...overrides,
    })
    getSessionMock.mockResolvedValue(session)

    const { prepareNewAnalysisAction } = await import("./actions-step-state")

    const result = await prepareNewAnalysisAction()

    expect(result).toEqual({ ok: false, reason: "auth_mismatch" })
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("confirms upstream authentication before preparing the first analysis", async () => {
    const session = createAuthenticatedSession({
      authVerifiedAt: "",
      rootStep: RootStep.auth,
      stage: Stage.confirmationSent,
    })
    getSessionMock.mockResolvedValue(session)

    const { confirmAuthenticationAndPrepareAnalysisAction } = await import(
      "./actions-step-state"
    )

    const result = await confirmAuthenticationAndPrepareAnalysisAction()

    expect(verifyAuthenticationMock).toHaveBeenCalledWith(session)
    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.authenticated,
        step: RootStep.document,
      },
    })
    expect(sessionSaveMock).toHaveBeenCalledTimes(1)
  })

  it("uses the auth proof added during upstream verification", async () => {
    const session = createAuthenticatedSession({
      authVerifiedAt: "",
      rootStep: RootStep.auth,
      stage: Stage.confirmationSent,
    })
    getSessionMock.mockResolvedValue(session)

    const { confirmAuthenticationAndPrepareAnalysisAction } = await import(
      "./actions-step-state"
    )

    const result = await confirmAuthenticationAndPrepareAnalysisAction()

    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.authenticated,
        step: RootStep.document,
      },
    })
    expect(session.authVerifiedAt).toBe("2026-04-28T01:02:03.000Z")
    expect(sessionSaveMock).toHaveBeenCalledTimes(1)
  })

  it("does not save auth proof when analysis stage resolution fails", async () => {
    const session = createAuthenticatedSession({
      authVerifiedAt: "",
      rootStep: RootStep.auth,
      stage: Stage.confirmationSent,
    })
    getSessionMock.mockResolvedValue(session)
    verifyAuthenticationMock.mockImplementationOnce(async (current) => {
      current.authVerifiedAt = "2026-04-28T01:02:03.000Z"
      delete current.questionnaireKind
      return { ok: true }
    })

    const { confirmAuthenticationAndPrepareAnalysisAction } = await import(
      "./actions-step-state"
    )

    const result = await confirmAuthenticationAndPrepareAnalysisAction()

    expect(result).toEqual({ ok: false, reason: "stage_resolution_failed" })
    expect(session.authVerifiedAt).toBe("2026-04-28T01:02:03.000Z")
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("rejects a changed questionnaire before changing session state or sending answers", async () => {
    const session = {
      ...createAuthenticatedSession({ rootStep: RootStep.survey }),
      lastCompletedAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
    }
    getSessionMock.mockResolvedValue(session)
    const { completeSurveySubmissionAction } = await import(
      "./actions-step-state"
    )
    expect(
      await completeSurveySubmissionAction(
        { q1: "old answer" },
        session.lastCompletedAnalysisId,
        `jcs-v1:sha256:${"b".repeat(64)}`,
      ),
    ).toEqual({ ok: false, reason: "questionnaire_changed" })
    expect(sessionSaveMock).not.toHaveBeenCalled()
    expect(submitSurveyMock).not.toHaveBeenCalled()
    expect(session.rootStep).toBe(RootStep.survey)
  })

  it("submits the survey before completing the flow", async () => {
    const session = {
      ...createAuthenticatedSession({ rootStep: RootStep.survey }),
      lastCompletedAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
    }
    getSessionMock.mockResolvedValue(session)

    const { completeSurveySubmissionAction } = await import(
      "./actions-step-state"
    )

    const result = await completeSurveySubmissionAction(
      { q1: "yes" },
      session.lastCompletedAnalysisId,
      initialDefinitionId,
    )

    expect(submitSurveyMock).toHaveBeenCalledWith(
      session,
      { q1: "yes" },
      initialDefinitionId,
    )
    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.followUp,
        step: RootStep.thanks,
      },
    })
    expect(session.lastCompletedAnalysisId).toBe(`aerpp:aid-${"a".repeat(32)}`)
  })

  it.each([false, undefined, null, "false", 1, {}, []].map((ok) => ({ ok })))(
    "does not accept a survey with an unconfirmed success flag ($ok)",
    async ({ ok }) => {
      const session = {
        ...createAuthenticatedSession({ rootStep: RootStep.survey }),
        lastCompletedAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
      }
      getSessionMock.mockResolvedValue(session)
      submitSurveyMock.mockResolvedValue({ ok, reason: "submit_failed" })
      const { completeSurveySubmissionAction } = await import(
        "./actions-step-state"
      )

      expect(
        await completeSurveySubmissionAction(
          { q1: "yes" },
          session.lastCompletedAnalysisId,
          initialDefinitionId,
        ),
      ).toEqual({ ok: false, reason: "submit_failed" })
      expect(session.stage).toBe(Stage.authenticated)
      expect(session.rootStep).toBe(RootStep.survey)
      expect(session.questionnaireKind).toBe("initial")
      expect(session).not.toHaveProperty("submittedAnalysisId")
      expect(session).toHaveProperty(
        "pendingSurveyAnalysisId",
        session.lastCompletedAnalysisId,
      )
      // Only the pending retry is saved; acceptance is still unconfirmed.
      expect(sessionSaveMock).toHaveBeenCalledOnce()
    },
  )

  it.each([false, undefined, null, "false", 1, {}, []].map((ok) => ({ ok })))(
    "requires confirmed success before authentication, mail and withdrawal transitions ($ok)",
    async ({ ok }) => {
      const actions = await import("./actions-step-state")
      const session = {
        ...createAuthenticatedSession({
          stage: Stage.unauthenticated,
          rootStep: RootStep.consent,
        }),
        consentId: "test-consent",
        preparedConsentContext: "prepared-context",
      }
      getSessionMock.mockResolvedValue(session)
      prepareConsentForEmailMock.mockResolvedValue({
        ok,
        reason: "consent_context_failed",
      })
      expect(
        await actions.prepareConsentContextAction(
          "user@example.com",
          undefined,
          "a".repeat(64),
        ),
      ).toEqual({ ok: false, reason: "consent_context_failed" })
      sendMagicLinkEmailMock.mockResolvedValue({ ok, reason: "send_failed" })
      expect(
        await actions.sendConsentEmailAndMoveToAuthAction("user@example.com"),
      ).toEqual({ ok: false, reason: "send_failed" })
      expect(session.stage).toBe(Stage.unauthenticated)
      session.stage = Stage.confirmationSent
      session.rootStep = RootStep.auth
      expect(await actions.resendConsentEmailAction()).toEqual({
        ok: false,
        reason: "send_failed",
      })
      verifyAuthenticationMock.mockResolvedValue({ ok, reason: "auth_failed" })
      expect(
        await actions.confirmAuthenticationAndPrepareAnalysisAction(),
      ).toEqual({ ok: false, reason: "auth_failed" })
      expect(session.stage).toBe(Stage.confirmationSent)
      session.stage = Stage.authenticated
      session.rootStep = RootStep.document
      withdrawParticipationMock.mockResolvedValue({
        ok,
        reason: "withdraw_failed",
      })
      expect(
        await actions.completeWithdrawalAction("user@example.com"),
      ).toEqual({ ok: false, reason: "withdraw_failed" })
      expect(session.stage).toBe(Stage.authenticated)
      expect(session.authVerifiedAt).toBeDefined()
      expect(sessionSaveMock).not.toHaveBeenCalled()
    },
  )

  it.each(
    [false, undefined, null, "false", 1, {}, []].map((confirmed) => ({
      confirmed,
    })),
  )(
    "rejects an unconfirmed local authentication result ($confirmed)",
    async ({ confirmed }) => {
      const authentication = await import("@/features/auth/auth-session")
      const guard = vi
        .spyOn(authentication, "isLocallyAuthenticated")
        .mockReturnValue(confirmed as boolean)
      const session = createAuthenticatedSession()
      getSessionMock.mockResolvedValue(session)
      try {
        const { startAnalysisAction } = await import("./actions-step-state")
        expect(await startAnalysisAction()).toEqual({
          ok: false,
          reason: "auth_mismatch",
        })
        expect(session.rootStep).toBe(RootStep.document)
        expect(sessionSaveMock).not.toHaveBeenCalled()
      } finally {
        guard.mockRestore()
      }
    },
  )

  it.each([undefined, null, "", "invalid", { analysisId: "forged" }])(
    "rejects missing or invalid displayed analysis IDs at both survey action boundaries (%j)",
    async (expectedAnalysisId) => {
      const session = {
        ...createAuthenticatedSession({ rootStep: RootStep.result }),
        lastCompletedAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
      }
      getSessionMock.mockResolvedValue(session)
      const { startSurveyAction, completeSurveySubmissionAction } =
        await import("./actions-step-state")
      await expect(
        startSurveyAction(expectedAnalysisId as string),
      ).resolves.toEqual({ ok: false, reason: "analysis_mismatch" })
      session.rootStep = RootStep.survey
      await expect(
        completeSurveySubmissionAction(
          { q1: "yes" },
          expectedAnalysisId as string,
          initialDefinitionId,
        ),
      ).resolves.toEqual({ ok: false, reason: "analysis_mismatch" })
      expect(submitSurveyMock).not.toHaveBeenCalled()
      expect(sessionSaveMock).not.toHaveBeenCalled()
    },
  )

  it("starts the survey only after a completed analysis was finalized", async () => {
    const session = {
      ...createAuthenticatedSession({ rootStep: RootStep.result }),
      lastCompletedAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
    }
    getSessionMock.mockResolvedValue(session)
    const { startSurveyAction } = await import("./actions-step-state")

    await expect(
      startSurveyAction(`aerpp:aid-${"a".repeat(32)}`),
    ).resolves.toEqual({
      ok: true,
      stepState: {
        stage: Stage.authenticated,
        step: RootStep.survey,
      },
    })

    delete (session as { lastCompletedAnalysisId?: string })
      .lastCompletedAnalysisId
    session.rootStep = RootStep.result
    await expect(
      startSurveyAction(`aerpp:aid-${"a".repeat(32)}`),
    ).resolves.toEqual({
      ok: false,
      reason: "analysis_mismatch",
    })
  })

  it("clears a previous analysis id before starting a new analysis", async () => {
    const session = {
      ...createAuthenticatedSession({
        stage: Stage.followUp,
        rootStep: RootStep.document,
      }),
      lastCompletedAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
    }
    getSessionMock.mockResolvedValue(session)
    const { startAnalysisAction } = await import("./actions-step-state")

    await expect(startAnalysisAction()).resolves.toEqual({
      ok: true,
      stepState: {
        stage: Stage.followUp,
        step: RootStep.result,
      },
    })
    expect(session.lastCompletedAnalysisId).toBeUndefined()
  })

  it("rejects withdrawal before email authentication without sending upstream", async () => {
    const session = createAuthenticatedSession({
      stage: Stage.confirmationSent,
      rootStep: RootStep.auth,
      authVerifiedAt: "",
    })
    getSessionMock.mockResolvedValue(session)
    const { completeWithdrawalAction } = await import("./actions-step-state")
    expect(await completeWithdrawalAction("user@example.com")).toEqual({
      ok: false,
      reason: "stage_mismatch",
    })
    expect(withdrawParticipationMock).not.toHaveBeenCalled()
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("resends only the persisted consent request without advancing authentication", async () => {
    const session = {
      ...createAuthenticatedSession({
        stage: Stage.confirmationSent,
        rootStep: RootStep.auth,
        authVerifiedAt: "",
      }),
      consentId: "A".repeat(20),
      preparedConsentContext: "persisted-context",
    }
    getSessionMock.mockResolvedValue(session)
    const { resendConsentEmailAction } = await import("./actions-step-state")
    expect(await resendConsentEmailAction()).toEqual({
      ok: true,
      stepState: { stage: Stage.confirmationSent, step: RootStep.auth },
    })
    expect(sendMagicLinkEmailMock).toHaveBeenCalledWith(
      session,
      "user@example.com",
      "persisted-context",
    )
    expect(prepareConsentForEmailMock).not.toHaveBeenCalled()
    expect(sessionSaveMock).not.toHaveBeenCalled()
    expect(session.authVerifiedAt).toBe("")
  })

  it.each([
    Stage.unauthenticated,
    Stage.authenticated,
    Stage.followUp,
    Stage.withdrawn,
  ])("rejects mail resend from %s", async (stage) => {
    getSessionMock.mockResolvedValue(createAuthenticatedSession({ stage }))
    const { resendConsentEmailAction } = await import("./actions-step-state")
    expect((await resendConsentEmailAction()).ok).toBe(false)
    expect(sendMagicLinkEmailMock).not.toHaveBeenCalled()
  })

  it("clears auth proof when completing withdrawal", async () => {
    const session = createAuthenticatedSession({ rootStep: RootStep.document })
    Object.assign(session, {
      withdrawalRequest: {
        consentId: "consent-1",
        serverId: "server-1",
        clientId: session.clientId,
        pseudonym: session.pseudonym,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: "sealed-email",
      },
    })
    getSessionMock.mockResolvedValue(session)

    const { completeWithdrawalAction } = await import("./actions-step-state")

    const result = await completeWithdrawalAction("user@example.com")

    expect(withdrawParticipationMock).toHaveBeenCalledWith(
      session,
      "user@example.com",
    )
    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.withdrawn,
        step: RootStep.withdrawn,
      },
    })
    expect(session.authVerifiedAt).toBeUndefined()
  })

  it.each([false, true, null, undefined])(
    "keeps withdrawal terminal regardless of completion evidence: %s",
    async (hasCompletedAnalysis) => {
      const session = createAuthenticatedSession({
        rootStep: RootStep.document,
      })
      Object.assign(session, {
        withdrawalRequest: {
          consentId: "consent-1",
          serverId: "server-1",
          clientId: session.clientId,
          pseudonym: session.pseudonym,
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
          encryptedEmail: "sealed-email",
        },
      })
      getSessionMock.mockResolvedValue(session)
      withdrawParticipationMock.mockResolvedValue({
        ok: true,
        cleanupPending: false,
        hasCompletedAnalysis,
      })
      const { completeWithdrawalAction, readWithdrawalCleanupAction } =
        await import("./actions-step-state")
      const result = await completeWithdrawalAction("user@example.com")
      expect(result).toMatchObject({
        ok: true,
        stepState: { stage: Stage.withdrawn },
      })
      expect(result).not.toHaveProperty("withdrawalRestartAllowed")
      const restored = await readWithdrawalCleanupAction()
      expect(restored).not.toHaveProperty("withdrawalRestartAllowed")
      expect(restored).toMatchObject({
        ok: true,
        stepState: { stage: Stage.withdrawn, step: RootStep.withdrawn },
      })
      expect(withdrawParticipationMock).toHaveBeenCalledTimes(1)
    },
  )

  it("keeps withdrawal terminal when persisting completed cleanup fails", async () => {
    const session = createAuthenticatedSession({ rootStep: RootStep.document })
    session.save.mockRejectedValueOnce(new Error("save failed"))
    Object.assign(session, {
      withdrawalRequest: {
        consentId: "consent-1",
        serverId: "server-1",
        clientId: session.clientId,
        pseudonym: session.pseudonym,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: "sealed-email",
      },
    })
    getSessionMock.mockResolvedValue(session)
    withdrawParticipationMock.mockResolvedValue({
      ok: true,
      cleanupPending: false,
      hasCompletedAnalysis: false,
    })
    const { completeWithdrawalAction } = await import("./actions-step-state")
    const result = await completeWithdrawalAction("user@example.com")
    expect(result).toMatchObject({ ok: true, withdrawalStateWriteFailed: true })
    expect(result).not.toHaveProperty("withdrawalRestartAllowed")
  })

  it("allows withdrawal without local auth proof after checking stage and email upstream", async () => {
    const session = createAuthenticatedSession({
      authVerifiedAt: "",
      rootStep: RootStep.document,
    })
    Object.assign(session, {
      withdrawalRequest: {
        consentId: "consent-1",
        serverId: "server-1",
        clientId: session.clientId,
        pseudonym: session.pseudonym,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: "sealed-email",
      },
    })
    getSessionMock.mockResolvedValue(session)

    const { completeWithdrawalAction } = await import("./actions-step-state")

    const result = await completeWithdrawalAction("user@example.com")

    expect(withdrawParticipationMock).toHaveBeenCalledWith(
      session,
      "user@example.com",
    )
    expect(result).toEqual({
      ok: true,
      stepState: {
        stage: Stage.withdrawn,
        step: RootStep.withdrawn,
      },
    })
  })

  it("does not persist intro normalization over invalid state", async () => {
    const session = {
      ...createAuthenticatedSession(),
      stage: "invalid",
      rootStep: "invalid",
    }
    getSessionMock.mockResolvedValue(session)
    const { moveToExplanationAction } = await import("./actions-step-state")
    expect((await moveToExplanationAction()).ok).toBe(true)
    expect(session.stage).toBe("invalid")
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "stops participation after committed withdrawal even when cookie save fails: %s",
    async (saveFails) => {
      const session = createAuthenticatedSession({
        rootStep: RootStep.document,
      })
      if (saveFails)
        session.save.mockRejectedValueOnce(new Error("cookie write"))
      Object.assign(session, {
        withdrawalRequest: {
          consentId: "consent-1",
          serverId: "server-1",
          clientId: session.clientId,
          pseudonym: session.pseudonym,
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
          encryptedEmail: "sealed-email",
        },
      })
      getSessionMock.mockResolvedValue(session)
      withdrawParticipationMock.mockResolvedValue({
        ok: true,
        cleanupPending: true,
      })
      const { completeWithdrawalAction } = await import("./actions-step-state")
      expect(await completeWithdrawalAction("user@example.com")).toEqual({
        ok: true,
        stepState: { stage: Stage.withdrawn, step: RootStep.withdrawn },
        withdrawalCleanupPending: true,
        ...(saveFails ? { withdrawalStateWriteFailed: true } : {}),
      })
      expect(session.authVerifiedAt).toBeUndefined()
      expect(session).not.toHaveProperty("lastCompletedAnalysisId")
      expect(session).not.toHaveProperty("activeAnalysisId")
      expect(session).toHaveProperty("withdrawalCleanupCompleted", false)
    },
  )

  it("allows cleanup retry from the terminal withdrawn state", async () => {
    const session = createAuthenticatedSession({
      stage: Stage.withdrawn,
      rootStep: RootStep.withdrawn,
    })
    Object.assign(session, {
      withdrawalRequest: {
        consentId: "consent-1",
        serverId: "server-1",
        clientId: session.clientId,
        pseudonym: session.pseudonym,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: "sealed-email",
      },
    })
    getSessionMock.mockResolvedValue(session)
    withdrawParticipationMock.mockResolvedValue({
      ok: true,
      cleanupPending: false,
    })
    const { completeWithdrawalAction } = await import("./actions-step-state")
    expect((await completeWithdrawalAction("user@example.com")).ok).toBe(true)
    expect(withdrawParticipationMock).toHaveBeenCalled()
    expect(session.stage).toBe(Stage.withdrawn)
    expect(session).toHaveProperty("withdrawalCleanupCompleted", true)
  })

  it.each(["activeAnalysisId", "lastCompletedAnalysisId"])(
    "clears %s and authentication proof when resetting the flow",
    async (field) => {
      const session = {
        ...createAuthenticatedSession({
          stage: Stage.followUp,
          rootStep: RootStep.result,
        }),
        [field]: `aerpp:aid-${"r".repeat(32)}`,
        coordinationId: "session",
      }
      getSessionMock.mockResolvedValue(session)
      readExecutionMock.mockReturnValue("failed")
      const { resetFlowAction } = await import("./actions-step-state")
      expect(await resetFlowAction()).toEqual({
        ok: true,
        stepState: { stage: Stage.unauthenticated, step: RootStep.start },
      })
      expect(session.stage).toBe(Stage.unauthenticated)
      expect(session.rootStep).toBe(RootStep.start)
      expect(session).not.toHaveProperty(field)
      expect(session).not.toHaveProperty("authVerifiedAt")
      expect(sessionSaveMock).toHaveBeenCalledTimes(1)
    },
  )

  it("clears withdrawal completion and retry data on reset", async () => {
    const session = {
      ...createAuthenticatedSession({
        stage: Stage.withdrawn,
        rootStep: RootStep.withdrawn,
      }),
      withdrawalCleanupCompleted: true,
      withdrawalRequest: { retained: true },
    }
    getSessionMock.mockResolvedValue(session)
    const { resetFlowAction } = await import("./actions-step-state")
    expect((await resetFlowAction()).ok).toBe(true)
    expect(session).not.toHaveProperty("withdrawalCleanupCompleted")
    expect(session).not.toHaveProperty("withdrawalRequest")
  })

  it.each([Stage.withdrawn, Stage.authenticated])(
    "reuses the saved withdrawal identity after %s without client email",
    async (stage) => {
      const session = {
        ...createAuthenticatedSession({
          stage,
          rootStep:
            stage === Stage.withdrawn ? RootStep.withdrawn : RootStep.document,
        }),
        withdrawalRequest: {
          serverId: "example",
          clientId: "client",
          pseudonym: "participant",
          consentId: "consent",
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
          encryptedEmail: "sealed-email",
        },
      }
      getSessionMock.mockResolvedValue(session)
      withdrawParticipationMock.mockResolvedValue({
        ok: true,
        cleanupPending: false,
      })
      const { retryWithdrawalCleanupAction } = await import(
        "./actions-step-state"
      )
      expect((await retryWithdrawalCleanupAction()).ok).toBe(true)
      expect(withdrawParticipationMock).toHaveBeenCalledWith(
        session,
        "user@example.com",
      )
    },
  )

  it("reads persisted cleanup completion without another upstream deletion", async () => {
    getSessionMock.mockResolvedValue({
      ...createAuthenticatedSession({
        stage: Stage.withdrawn,
        rootStep: RootStep.withdrawn,
      }),
      withdrawalCleanupCompleted: true,
    })
    const { retryWithdrawalCleanupAction } = await import(
      "./actions-step-state"
    )
    expect((await retryWithdrawalCleanupAction()).ok).toBe(true)
    expect(withdrawParticipationMock).not.toHaveBeenCalled()
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("reads pending cleanup without retrying upstream deletion on the withdrawal form", async () => {
    getSessionMock.mockResolvedValue({
      ...createAuthenticatedSession({
        stage: Stage.withdrawn,
        rootStep: RootStep.withdrawn,
      }),
      withdrawalCleanupCompleted: false,
    })
    const { readWithdrawalCleanupAction } = await import("./actions-step-state")
    expect(await readWithdrawalCleanupAction()).toMatchObject({
      ok: true,
      withdrawalCleanupPending: true,
    })
    expect(withdrawParticipationMock).not.toHaveBeenCalled()
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it.each([Stage.authenticated, Stage.confirmationSent, Stage.withdrawn])(
    "rejects automatic cleanup without a saved withdrawal for %s",
    async (stage) => {
      getSessionMock.mockResolvedValue(
        createAuthenticatedSession({
          stage,
          rootStep:
            stage === Stage.withdrawn
              ? RootStep.withdrawn
              : stage === Stage.confirmationSent
                ? RootStep.auth
                : RootStep.document,
        }),
      )
      const { retryWithdrawalCleanupAction } = await import(
        "./actions-step-state"
      )
      expect((await retryWithdrawalCleanupAction()).ok).toBe(false)
      expect(withdrawParticipationMock).not.toHaveBeenCalled()
    },
  )
})

// Admission has dedicated authority tests and real-cookie browser coverage.
vi.mock("@/features/session/session-operation", () => ({
  withSessionRead: (_token: unknown, operation: () => Promise<unknown>) =>
    operation(),
  withWithdrawalCleanupOperation: (
    _token: unknown,
    operation: () => Promise<unknown>,
  ) => operation(),
  withWithdrawalOperation: (
    _token: unknown,
    _email: string,
    operation: () => Promise<unknown>,
  ) => operation(),
  withSessionOperation: (
    _token: unknown,
    _kind: string,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

it("prepares consent from any intro view without persisting a transition", async () => {
  vi.clearAllMocks()
  const session = {
    stage: Stage.unauthenticated,
    rootStep: RootStep.consent,
    save: sessionSaveMock,
  }
  getSessionMock.mockResolvedValue(session)
  prepareConsentForEmailMock.mockResolvedValue({
    ok: true,
    consentContext: "sealed-context",
  })
  const { prepareConsentContextAction } = await import("./actions-step-state")
  expect(
    await prepareConsentContextAction(
      "user@example.com",
      undefined,
      "a".repeat(64),
    ),
  ).toEqual({
    ok: true,
    consentContext: "sealed-context",
    stepState: { stage: Stage.unauthenticated, step: RootStep.consent },
  })
  expect(sessionSaveMock).not.toHaveBeenCalled()
  getSessionMock.mockResolvedValue({
    ...session,
    rootStep: RootStep.explanation,
  })
  expect(
    (
      await prepareConsentContextAction(
        "user@example.com",
        undefined,
        "a".repeat(64),
      )
    ).ok,
  ).toBe(true)
  expect(prepareConsentForEmailMock).toHaveBeenCalledTimes(2)
})

beforeEach(() => {
  sessionSaveMock.mockReset().mockResolvedValue(true)
  cancelJobMock.mockReset().mockResolvedValue({ status: "idle" })
  recordUnavailableMock.mockReset().mockResolvedValue(true)
})
it.each(["running", "completed", "unconfirmed", null])(
  "rejects ordinary recovery of protected inference (%s)",
  async (outcome) => {
    const session = {
      ...createAuthenticatedSession({ rootStep: RootStep.result }),
      coordinationId: "session",
      activeAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
    }
    getSessionMock.mockResolvedValue(session)
    readExecutionMock.mockReturnValue(outcome)
    const { failAnalysisAction, prepareNewAnalysisAction, resetFlowAction } =
      await import("./actions-step-state")
    for (const action of [
      failAnalysisAction,
      prepareNewAnalysisAction,
      resetFlowAction,
    ])
      expect((await action()).ok).toBe(false)
    expect(session.activeAnalysisId).toBe(`aerpp:aid-${"a".repeat(32)}`)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  },
)
it.each(["failed", "cancelled"])(
  "allows explicit cancellation only after a confirmed terminal (%s)",
  async (outcome) => {
    const session = {
      ...createAuthenticatedSession({ rootStep: RootStep.result }),
      coordinationId: "session",
      activeAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
    }
    getSessionMock.mockResolvedValue(session)
    readExecutionMock.mockReturnValue(outcome)
    const { cancelAnalysisAction } = await import("./actions-step-state")
    expect((await cancelAnalysisAction()).ok).toBe(true)
    expect(session).not.toHaveProperty("activeAnalysisId")
    expect(sessionSaveMock).toHaveBeenCalledOnce()
  },
)
it("keeps completed output available when cancellation arrives after inference completion", async () => {
  const session = {
    ...createAuthenticatedSession({ rootStep: RootStep.result }),
    coordinationId: "session",
    activeAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
  }
  getSessionMock.mockResolvedValue(session)
  readExecutionMock.mockReturnValue("completed")
  const { cancelAnalysisAction } = await import("./actions-step-state")
  expect(await cancelAnalysisAction()).toMatchObject({
    ok: false,
    reason: "analysis_completed",
  })
  expect(sessionSaveMock).not.toHaveBeenCalled()
})

it.each(["active", "finalized", "initial-active", "initial-finalized"])(
  "recovers unavailable unpresented output (%s)",
  async (phase) => {
    const id = `aerpp:aid-${"a".repeat(32)}`
    const session = {
      ...createAuthenticatedSession({
        stage: phase.startsWith("initial")
          ? Stage.authenticated
          : Stage.followUp,
        rootStep: RootStep.result,
      }),
      coordinationId: "session",
      ...(phase.endsWith("active")
        ? { activeAnalysisId: id }
        : { lastCompletedAnalysisId: id }),
    }
    getSessionMock.mockResolvedValue(session)
    readExecutionMock.mockReturnValue("completed")
    readJobStatusMock.mockResolvedValue({
      analysisId: id,
      status: "unavailable",
      canRecover: true,
    })
    const { recoverUnavailableAnalysisAction } = await import(
      "./actions-step-state"
    )
    expect(await recoverUnavailableAnalysisAction(id)).toMatchObject({
      ok: true,
      stepState: {
        stage: phase.startsWith("initial")
          ? Stage.authenticated
          : Stage.followUp,
        step: RootStep.document,
      },
    })
    expect(recordUnavailableMock).toHaveBeenCalledOnce()
    expect(session).not.toHaveProperty("activeAnalysisId")
    expect(session).not.toHaveProperty("lastCompletedAnalysisId")
  },
)
it.each([
  { status: "running", canRecover: false },
  { status: "ready", canRecover: false },
  { status: "completion_pending", canRecover: false },
  { status: "termination_pending", canRecover: false },
  { status: "unconfirmed", canRecover: false },
  { status: "unavailable", canRecover: false },
])(
  "rejects unavailable-result recovery without recoverable loss (%j)",
  async (observation) => {
    const id = `aerpp:aid-${"a".repeat(32)}`
    getSessionMock.mockResolvedValue({
      ...createAuthenticatedSession({
        stage: Stage.followUp,
        rootStep: RootStep.result,
      }),
      coordinationId: "session",
      activeAnalysisId: id,
    })
    readJobStatusMock.mockResolvedValue({ analysisId: id, ...observation })
    const { recoverUnavailableAnalysisAction } = await import(
      "./actions-step-state"
    )
    expect((await recoverUnavailableAnalysisAction(id)).ok).toBe(false)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  },
)
it.each(["initial", "stale"])(
  "rejects stale analysis IDs in initial/follow-up recovery (%s)",
  async (condition) => {
    const id = `aerpp:aid-${"a".repeat(32)}`
    getSessionMock.mockResolvedValue({
      ...createAuthenticatedSession({
        stage: condition === "initial" ? Stage.authenticated : Stage.followUp,
        rootStep: RootStep.result,
      }),
      coordinationId: "session",
      activeAnalysisId: id,
    })
    readJobStatusMock.mockResolvedValue({
      analysisId: `aerpp:aid-${"b".repeat(32)}`,
      status: "unavailable",
      canRecover: true,
    })
    const { recoverUnavailableAnalysisAction } = await import(
      "./actions-step-state"
    )
    expect((await recoverUnavailableAnalysisAction(id)).ok).toBe(false)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  },
)

it("keeps initial completion protected when Support cannot confirm recovery", async () => {
  const id = `aerpp:aid-${"a".repeat(32)}`
  const session = {
    ...createAuthenticatedSession({ rootStep: RootStep.result }),
    coordinationId: "session",
    lastCompletedAnalysisId: id,
  }
  getSessionMock.mockResolvedValue(session)
  readJobStatusMock.mockResolvedValue({
    analysisId: id,
    status: "unavailable",
    canRecover: true,
  })
  recordUnavailableMock.mockResolvedValueOnce(false)
  const { recoverUnavailableAnalysisAction } = await import(
    "./actions-step-state"
  )
  expect(await recoverUnavailableAnalysisAction(id)).toMatchObject({
    ok: false,
    reason: "analysis_recovery_unconfirmed",
  })
  expect(sessionSaveMock).not.toHaveBeenCalled()
  expect(session.lastCompletedAnalysisId).toBe(id)
})

it("opens an administrator-authorized original initial survey after authentication without a result body or a new analysis", async () => {
  vi.clearAllMocks()
  sessionSaveMock.mockReset().mockResolvedValue(true)
  const session = createAuthenticatedSession({
    stage: Stage.confirmationSent,
    rootStep: RootStep.auth,
  })
  getSessionMock.mockResolvedValue(session)
  const analysisId = `aerpp:aid-${"a".repeat(32)}`
  verifyAuthenticationMock.mockResolvedValueOnce({
    ok: true,
    authVerifiedAt: "2026-04-28T00:00:00.000Z",
    recoveredSurveyAnalysisId: analysisId,
  })
  const { confirmAuthenticationAndPrepareAnalysis } = await import(
    "./step-state-transition-service"
  )
  expect(await confirmAuthenticationAndPrepareAnalysis()).toMatchObject({
    ok: true,
    stepState: { stage: Stage.authenticated, step: RootStep.survey },
    recoveredSurveyAnalysisId: analysisId,
  })
  expect(session).toMatchObject({
    lastCompletedAnalysisId: analysisId,
    presentedAnalysisId: analysisId,
    recoveredSurveyAnalysisId: analysisId,
  })
})

it.each(["running", "unconfirmed", "termination_pending"])(
  "preserves attempt ownership when cancellation is %s",
  async (status) => {
    const session = {
      ...createAuthenticatedSession({ rootStep: RootStep.result }),
      coordinationId: "session",
      activeAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
    }
    getSessionMock.mockResolvedValue(session)
    readExecutionMock.mockReturnValue(
      status === "running" ? "running" : "unconfirmed",
    )
    cancelJobMock.mockResolvedValue({ status })
    const { cancelAnalysisAction } = await import("./actions-step-state")
    expect(await cancelAnalysisAction()).toMatchObject({ ok: false })
    expect(session.activeAnalysisId).toBe(`aerpp:aid-${"a".repeat(32)}`)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  },
)
