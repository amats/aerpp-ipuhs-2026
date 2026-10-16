import { beforeEach, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"

const {
  begin,
  reserve,
  start,
  release,
  execution,
  operation,
  readiness,
  terminate,
} = vi.hoisted(() => ({
  terminate: vi.fn(),
  readiness: vi.fn(),
  begin: vi.fn(),
  reserve: vi.fn(),
  start: vi.fn(),
  release: vi.fn(),
  execution: vi.fn(),
  operation: vi.fn(),
}))
vi.mock("./analysis-readiness", () => ({ checkAnalysisReadiness: readiness }))
vi.mock("./analysis-attempt", () => ({ beginAnalysisAttempt: begin }))
vi.mock("./analysis-job-registry", () => ({ reserveAnalysisJob: reserve }))
vi.mock("@/features/identity/random-id", () => ({
  generateRandomIdSuffix: () => "a".repeat(32),
}))
vi.mock("@/lib/session-authority", () => ({
  sessionOperation: { getStore: operation },
  setAnalysisOperation: execution,
}))
const { acceptAnalysisJob } = await import("./analysis-job-service")
const input = {
  prompt: "private prompt",
  documentCount: 1,
  documentGraphemeCount: 10,
  documentGraphemeCounts: [8],
}
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
const saved = vi.fn()
function session() {
  return {
    coordinationId: "session",
    clientId: "client",
    pseudonym: "participant",
    consentId: "consent",
    save: saved,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  saved.mockResolvedValue(undefined)
  reserve.mockReturnValue({ start, release, terminate })
  terminate.mockImplementation(async (attempt) => {
    await attempt.finish("cancelled")
  })
  begin.mockResolvedValue({ finish: vi.fn(), questionnaireKind: "initial" })
  operation.mockReturnValue(undefined)
  readiness.mockResolvedValue({ ok: true })
})

it("records a new attempt with the retained measurements and exact prompt", async () => {
  const owner = { ...session(), activeAnalysisId: "failed-attempt" }
  const accepted = await acceptAnalysisJob({
    session: owner as never,
    input,
    expectedFailedId: "failed-attempt",
    logger: logger as never,
  })
  expect(accepted.ok).toBe(true)
  expect(owner.activeAnalysisId).not.toBe("failed-attempt")
  expect(begin.mock.calls[0][0]).toMatchObject({ documentGraphemeCounts: [8] })
  expect(begin.mock.calls[0][0]).not.toHaveProperty("documents")
  expect(start.mock.calls[0][0]).toMatchObject(input)
  expect(saved).toHaveBeenCalledTimes(2)
})

it("includes admission time in the elapsed duration returned to the browser", async () => {
  const now = Date.now()
  vi.spyOn(Date, "now").mockReturnValue(now)
  try {
    expect(
      await acceptAnalysisJob({
        session: session() as never,
        input,
        startedAtMs: now - 2500,
        logger: logger as never,
      }),
    ).toMatchObject({
      ok: true,
      startedAtMs: now - 2500,
      elapsedMs: 2500,
    })
  } finally {
    vi.restoreAllMocks()
  }
})

it.each([
  { activeAnalysisId: "another-attempt" },
  { lastCompletedAnalysisId: "completed-attempt" },
])(
  "rejects conflicting or completed work before starting inference (%#)",
  async (state) => {
    const accepted = await acceptAnalysisJob({
      session: { ...session(), ...state } as never,
      input,
      logger: logger as never,
    })
    expect(accepted).toEqual({ ok: false, reason: "analysis_mismatch" })
    expect(reserve).not.toHaveBeenCalled()
    expect(begin).not.toHaveBeenCalled()
  },
)

it("protects ambiguous start observations without running the model", async () => {
  begin.mockResolvedValue(null)
  expect(
    await acceptAnalysisJob({
      session: session() as never,
      input,
      logger: logger as never,
    }),
  ).toEqual({ ok: false, reason: "start_unconfirmed" })
  expect(start).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
  expect(execution).toHaveBeenLastCalledWith(
    "session",
    expect.any(String),
    "unconfirmed",
  )
})

it("persists the authoritative follow-up kind before inference starts", async () => {
  begin.mockResolvedValue({ finish: vi.fn(), questionnaireKind: "follow-up" })
  const owner = {
    ...session(),
    stage: Stage.authenticated,
    questionnaireKind: "initial",
  }
  saved.mockImplementation(async () => {
    if (saved.mock.calls.length === 2) {
      expect(start).not.toHaveBeenCalled()
      expect(owner).toMatchObject({
        stage: Stage.followUp,
        questionnaireKind: "follow-up",
      })
    }
  })
  expect(
    await acceptAnalysisJob({
      session: owner as never,
      input,
      logger: logger as never,
    }),
  ).toMatchObject({
    ok: true,
    questionnaireKind: "follow-up",
  })
  expect(saved).toHaveBeenCalledTimes(2)
  expect(start).toHaveBeenCalledOnce()
})

it.each([true, false])(
  "cancels a confirmed start after local admission fails, retaining uncertain acknowledgement (%s)",
  async (acknowledged) => {
    const finish = vi.fn().mockResolvedValue(acknowledged)
    begin.mockResolvedValue({ finish, questionnaireKind: "initial" })
    saved
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("unavailable"))
    expect(
      await acceptAnalysisJob({
        session: session() as never,
        input,
        logger: logger as never,
      }),
    ).toEqual({
      ok: false,
      reason: "start_unconfirmed",
    })
    expect(begin).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    expect(terminate).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledExactlyOnceWith("cancelled")
  },
)

it("releases the reservation after an authority write failure", async () => {
  const finish = vi.fn()
  begin.mockResolvedValue({ finish, questionnaireKind: "initial" })
  saved.mockRejectedValue(new Error("unavailable"))
  expect(
    (
      await acceptAnalysisJob({
        session: session() as never,
        input,
        logger: logger as never,
      })
    ).ok,
  ).toBe(false)
  expect(release).toHaveBeenCalledOnce()
  expect(begin).not.toHaveBeenCalled()
  expect(finish).not.toHaveBeenCalled()
})

it.each(["start_acknowledgement", "participation_save"])(
  "records cancellation without inference when authority is revoked during %s",
  async (phase) => {
    const controller = new AbortController()
    operation.mockReturnValue({ signal: controller.signal })
    const finish = vi.fn()
    begin.mockImplementation(async () => {
      if (phase === "start_acknowledgement") controller.abort()
      return { finish, questionnaireKind: "initial" }
    })
    saved.mockImplementation(async () => {
      if (phase === "participation_save" && saved.mock.calls.length === 2)
        controller.abort()
    })
    expect(
      await acceptAnalysisJob({
        session: session() as never,
        input,
        logger: logger as never,
      }),
    ).toEqual({ ok: false, reason: "superseded_operation" })
    expect(finish).toHaveBeenCalledExactlyOnceWith("cancelled")
    expect(start).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    expect(terminate).toHaveBeenCalledOnce()
    expect(saved).toHaveBeenCalledTimes(
      phase === "start_acknowledgement" ? 1 : 2,
    )
  },
)

it.each([
  "analysis_storage_unavailable",
  "analysis_model_unavailable",
  "analysis_support_unavailable",
])(
  "does not claim an attempt or start inference when readiness fails (%s)",
  async (reason) => {
    readiness.mockResolvedValue({ ok: false, reason })
    const owner = session()
    expect(
      await acceptAnalysisJob({
        session: owner as never,
        input,
        logger: logger as never,
      }),
    ).toEqual({ ok: false, reason })
    expect(reserve).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
    expect(begin).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(owner).not.toHaveProperty("activeAnalysisId")
  },
)
