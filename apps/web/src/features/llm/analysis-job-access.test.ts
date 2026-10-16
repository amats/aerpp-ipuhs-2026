import { beforeEach, expect, it, vi } from "vitest"

const { memory, outcome, session, abandoned } = vi.hoisted(() => ({
  memory: vi.fn(),
  abandoned: vi.fn(),
  outcome: vi.fn(),
  session: vi.fn(),
}))
vi.mock("./analysis-job-registry", () => ({
  readMemoryAnalysisJob: memory,
  readMemoryAnalysisResult: vi.fn(),
}))
vi.mock("@/lib/session-authority", () => ({
  readAnalysisOperation: outcome,
  isAnalysisExecutionAbandoned: abandoned,
}))
vi.mock("@/lib/session", () => ({ getSessionForTab: session }))
vi.mock("@/features/auth/auth-session", () => ({
  readLocalAuthenticationFromSession: async () => ({
    clientId: "client",
    pseudonym: "participant",
  }),
  isLocallyAuthenticated: () => true,
}))
const { readAnalysisJobStatusForTab } = await import("./analysis-job-access")
const id = `aerpp:aid-${"a".repeat(32)}`
beforeEach(() => {
  vi.clearAllMocks()
  abandoned.mockReturnValue(false)
  memory.mockReturnValue(null)
  outcome.mockReturnValue("completed")
})
it.each([
  { stage: "follow_up", presentedAnalysisId: undefined, recoverable: true },
  {
    stage: "authenticated",
    presentedAnalysisId: undefined,
    recoverable: true,
  },
  { stage: "follow_up", presentedAnalysisId: id, recoverable: true },
  { stage: "authenticated", presentedAnalysisId: id, recoverable: false },
])(
  "protects initial presentation while permitting follow-up loss recovery (%j)",
  async ({ recoverable, ...state }) => {
    session.mockResolvedValue({
      ...state,
      coordinationId: "session",
      consentId: "consent",
      activeAnalysisId: id,
    })
    expect(await readAnalysisJobStatusForTab("current-token")).toMatchObject({
      status: "unavailable",
      analysisId: id,
      canRecover: recoverable,
    })
  },
)
it.each(["running", "unconfirmed", null])(
  "does not treat ambiguous evidence as recoverable loss (%s)",
  async (recorded) => {
    outcome.mockReturnValue(recorded)
    session.mockResolvedValue({
      stage: "follow_up",
      coordinationId: "session",
      consentId: "consent",
      activeAnalysisId: id,
    })
    expect(await readAnalysisJobStatusForTab("current-token")).toMatchObject({
      status: "unconfirmed",
      canRecover: false,
    })
  },
)
it("keeps retained output available for completion retry", async () => {
  session.mockResolvedValue({
    stage: "follow_up",
    coordinationId: "session",
    consentId: "consent",
    activeAnalysisId: id,
  })
  memory.mockReturnValue({
    ok: true,
    status: "completion_pending",
    analysisId: id,
    startedAtMs: 1,
    elapsedMs: 0,
  })
  expect(await readAnalysisJobStatusForTab("current-token")).toMatchObject({
    status: "completion_pending",
  })
  expect(outcome).not.toHaveBeenCalled()
})

it("permits explicit recovery of an abandoned process without treating a live process as dead", async () => {
  outcome.mockReturnValue("running")
  abandoned.mockReturnValue(true)
  session.mockResolvedValue({
    stage: "authenticated",
    coordinationId: "session",
    consentId: "consent",
    activeAnalysisId: id,
  })
  expect(await readAnalysisJobStatusForTab("current-token")).toMatchObject({
    status: "unavailable",
    canRecover: true,
  })
  session.mockResolvedValue({
    stage: "authenticated",
    coordinationId: "session",
    consentId: "consent",
    activeAnalysisId: id,
    presentedAnalysisId: id,
  })
  expect(await readAnalysisJobStatusForTab("current-token")).toMatchObject({
    status: "unavailable",
    canRecover: false,
  })
})
it("uses durable completion evidence after transient operation metadata expires", async () => {
  outcome.mockReturnValue(null)
  session.mockResolvedValue({
    stage: "authenticated",
    coordinationId: "session",
    consentId: "consent",
    lastCompletedAnalysisId: id,
  })
  expect(await readAnalysisJobStatusForTab("current-token")).toMatchObject({
    status: "unavailable",
    canRecover: true,
  })
})

it.each(["failed", "cancelled"])(
  "preserves a confirmed %s outcome after its process exits",
  async (status) => {
    outcome.mockReturnValue(status)
    abandoned.mockReturnValue(true)
    session.mockResolvedValue({
      stage: "authenticated",
      coordinationId: "session",
      consentId: "consent",
      activeAnalysisId: id,
    })
    expect(await readAnalysisJobStatusForTab("current-token")).toMatchObject({
      status,
      canRecover: false,
    })
  },
)
