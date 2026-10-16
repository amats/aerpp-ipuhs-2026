import { beforeEach, describe, expect, it, vi } from "vitest"
import { RootStep } from "@/features/app-context/root-step-types"
import { Stage } from "@/features/app-context/stage-types"

const getSessionMock = vi.fn()
const sessionSaveMock = vi.fn()
const loggerMock = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: vi.fn(() => loggerMock),
  getRequestContextFromHeaders: vi.fn(() => ({})),
}))

describe("step-state-session", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionSaveMock.mockResolvedValue(true)
  })

  it("logs invalid persisted step state with a dedicated validation event", async () => {
    const session = {
      stage: Stage.unauthenticated,
      rootStep: RootStep.thanks,
    } as never

    const { readStepStateFromSession } = await import("./step-state-session")

    await expect(readStepStateFromSession(session)).resolves.toEqual({
      stage: Stage.unauthenticated,
      step: RootStep.start,
    })
    expect(loggerMock.warn).toHaveBeenCalledWith({
      event: "step_state.validation.rejected",
      outcome: "rejected",
      rootStep: RootStep.thanks,
      stage: Stage.unauthenticated,
    })
  })

  it("normalizes persisted withdrawn state to the terminal withdrawn step", async () => {
    const session = {
      stage: Stage.withdrawn,
      rootStep: RootStep.start,
    } as never

    const { readStepStateFromSession } = await import("./step-state-session")

    await expect(readStepStateFromSession(session)).resolves.toEqual({
      stage: Stage.withdrawn,
      step: RootStep.withdrawn,
    })
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it("reads missing state without mutating the session during rendering", async () => {
    const session = {
      activeAnalysisId: `aerpp:aid-${"a".repeat(32)}`,
      authVerifiedAt: "2026-04-28T00:00:00.000Z",
      lastCompletedAnalysisId: `aerpp:aid-${"b".repeat(32)}`,
      rootStep: undefined,
      save: sessionSaveMock,
      stage: undefined,
    }
    getSessionMock.mockResolvedValue(session)

    const { readInitialStepState } = await import("./step-state-session")

    await expect(readInitialStepState()).resolves.toEqual({
      stage: Stage.unauthenticated,
      step: RootStep.start,
    })
    expect(session.stage).toBeUndefined()
    expect(session.rootStep).toBeUndefined()
    expect(session.authVerifiedAt).toBe("2026-04-28T00:00:00.000Z")
    expect(session.activeAnalysisId).toBe(`aerpp:aid-${"a".repeat(32)}`)
    expect(session.lastCompletedAnalysisId).toBe(`aerpp:aid-${"b".repeat(32)}`)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("logs session read failures at the initialization boundary", async () => {
    const error = new Error("read failed")
    getSessionMock.mockRejectedValueOnce(error)
    const { readInitialStepState } = await import("./step-state-session")
    await expect(readInitialStepState()).resolves.toEqual({
      stage: Stage.unauthenticated,
      step: RootStep.start,
    })
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        event: "session.get.failed",
        operation: "step_state_read",
      }),
    )
  })

  it("normalizes withdrawn state without writing cookies during rendering", async () => {
    const session = {
      stage: Stage.withdrawn,
      rootStep: RootStep.start,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)

    const { readInitialStepState } = await import("./step-state-session")

    await expect(readInitialStepState()).resolves.toEqual({
      stage: Stage.withdrawn,
      step: RootStep.withdrawn,
    })
    expect(session.rootStep).toBe(RootStep.start)
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })

  it("does not persist valid existing step state", async () => {
    const session = {
      stage: Stage.unauthenticated,
      rootStep: RootStep.explanation,
      save: sessionSaveMock,
    }
    getSessionMock.mockResolvedValue(session)

    const { readInitialStepState } = await import("./step-state-session")

    await expect(readInitialStepState()).resolves.toEqual({
      stage: Stage.unauthenticated,
      step: RootStep.explanation,
    })
    expect(sessionSaveMock).not.toHaveBeenCalled()
  })
})
