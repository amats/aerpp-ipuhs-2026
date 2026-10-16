import { beforeEach, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"
import { sessionOperation } from "@/lib/session-authority"

const { enqueue, acknowledge, setOperation } = vi.hoisted(() => ({
  setOperation: vi.fn(),
  enqueue: vi.fn(),
  acknowledge: vi.fn(),
}))
vi.mock("@/lib/analysis-audit-store", () => ({
  analysisAuditStore: () => ({ enqueue, acknowledge }),
}))
vi.mock("@/lib/session-authority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session-authority")>()),
  setAnalysisOperation: setOperation,
}))
const fetchMock = vi.fn()
vi.mock("@/lib/fetch-with-retry", () => ({ fetchWithRetry: fetchMock }))
const { beginAnalysisAttempt, recordUnavailableAnalysis } = await import(
  "./analysis-attempt"
)
const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
const input = {
  analysisId: "attempt-1",
  session: {
    consentId: "consent-1",
    clientId: "client-1",
    pseudonym: "participant-1",
    stage: Stage.authenticated,
  },
  documentGraphemeCounts: [2, 2],
  logger,
}
beforeEach(() => {
  vi.resetAllMocks()
  enqueue.mockImplementation((_body, _now, checkpoint) =>
    checkpoint?.(undefined),
  )
  fetchMock.mockImplementation(async () =>
    Response.json({ ok: true, questionnaireKind: "initial" }),
  )
})
it("records body graphemes and consent without supplying questionnaire eligibility", async () => {
  expect(await beginAnalysisAttempt(input as never)).not.toBeNull()
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(payload).toEqual({
    analysisId: "attempt-1",
    consentId: "consent-1",
    clientId: "client-1",
    pseudonym: "participant-1",
    serverId: expect.any(String),
    outcome: "started",
    startedAtMs: expect.any(Number),
    documentGraphemeCounts: [2, 2],
  })
  expect(JSON.stringify(payload)).not.toMatch(/never-send-name|private|👨|é/)
})
it("uses the questionnaire kind confirmed at the start instead of the earlier local stage", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ ok: true, questionnaireKind: "follow-up" }),
  )
  expect(await beginAnalysisAttempt(input as never)).toMatchObject({
    questionnaireKind: "follow-up",
  })
})
it.each([{ ok: true }, { ok: true, questionnaireKind: "unknown" }])(
  "refuses a start without a valid authoritative questionnaire kind (%j)",
  async (response) => {
    fetchMock.mockResolvedValueOnce(Response.json(response))
    expect(await beginAnalysisAttempt(input as never)).toBeNull()
  },
)
it("requires a confirmed start response and refuses missing consent", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ error: "unavailable" }, { status: 503 }),
  )
  expect(await beginAnalysisAttempt(input as never)).toBeNull()
  fetchMock.mockClear()
  expect(
    await beginAnalysisAttempt({
      ...input,
      session: { ...input.session, consentId: undefined },
    } as never),
  ).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})
it("records one immutable terminal event outside cancelled session work", async () => {
  const cancellation = new AbortController()
  await sessionOperation.run(
    { id: "session", operationId: "operation", signal: cancellation.signal },
    async () => {
      const attempt = await beginAnalysisAttempt(input as never)
      expect(attempt).not.toBeNull()
      cancellation.abort()
      fetchMock.mockImplementationOnce(async () => {
        expect(sessionOperation.getStore()).toBeUndefined()
        return Response.json({ ok: true, questionnaireKind: "initial" })
      })
      await Promise.all([
        attempt?.finish("cancelled"),
        attempt?.finish("completed"),
      ])
    },
  )
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
    analysisId: "attempt-1",
    consentId: "consent-1",
    outcome: "cancelled",
    durationMs: expect.any(Number),
  })
})
it("reports terminal recording failure without inventing another outcome", async () => {
  const attempt = await beginAnalysisAttempt(input as never)
  fetchMock.mockRejectedValueOnce(new Error("offline"))
  expect(await attempt?.finish("failed")).toBe(false)
  expect(await attempt?.finish("completed")).toBe(false)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
it.each(["completed", "failed", "cancelled"] as const)(
  "retries the exact %s terminal record after acknowledgement loss without another start",
  async (outcome) => {
    const attempt = await beginAnalysisAttempt(input as never)
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    expect(await attempt?.finish(outcome)).toBe(false)
    const original = fetchMock.mock.calls[1][1].body
    expect(await attempt?.retryFinish()).toBe(true)
    expect(fetchMock.mock.calls[2][1].body).toBe(original)
    expect(await attempt?.retryFinish()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  },
)

it.each([true, false])(
  "requires acknowledged content-free recovery recording (confirmed=%s)",
  async (confirmed) => {
    fetchMock.mockResolvedValueOnce(
      confirmed
        ? Response.json({ ok: true, questionnaireKind: "initial" })
        : Response.json({ error: "temporary failure" }, { status: 503 }),
    )
    expect(await recordUnavailableAnalysis(input as never)).toBe(confirmed)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(payload).toMatchObject({
      analysisId: "attempt-1",
      outcome: "unavailable",
      reason: "result_unavailable",
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /never-send-name|private|documents|text/,
    )
  },
)

it("queues only operational facts before network delivery and retains them on acknowledgment loss", async () => {
  const attempt = await beginAnalysisAttempt(input as never)
  fetchMock.mockImplementationOnce(async () => {
    expect(enqueue).toHaveBeenCalledOnce()
    throw new Error("offline")
  })
  expect(await attempt?.finish("completed")).toBe(false)
  expect(enqueue.mock.calls[0][0]).toEqual({
    analysisId: "attempt-1",
    consentId: "consent-1",
    clientId: "client-1",
    pseudonym: "participant-1",
    serverId: expect.any(String),
    outcome: "completed",
    endedAtMs: expect.any(Number),
  })
  expect(acknowledge).not.toHaveBeenCalled()
  expect(await attempt?.retryFinish()).toBe(true)
  expect(acknowledge).toHaveBeenCalledWith(enqueue.mock.calls[0][0])
})
it("keeps an immutable terminal in memory for retry when the durable store fails", async () => {
  const attempt = await beginAnalysisAttempt(input as never)
  enqueue.mockImplementationOnce(() => {
    throw new Error("storage unavailable")
  })
  expect(await attempt?.finish("completed")).toBe(false)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(await attempt?.retryFinish()).toBe(true)
  expect(enqueue.mock.calls[1][0]).toEqual(enqueue.mock.calls[0][0])
})

it.each(["checkpoint", "local_confirmation"])(
  "resumes the frozen terminal after a transient %s failure",
  async (phase) => {
    const attempt = await beginAnalysisAttempt({
      ...input,
      session: { ...input.session, coordinationId: "session" },
    } as never)
    if (phase === "local_confirmation")
      setOperation.mockImplementationOnce(() => {})
    setOperation.mockImplementationOnce(() => {
      throw new Error("SQLite unavailable")
    })
    expect(await attempt?.finish("cancelled")).toBe(false)
    const frozenTime = enqueue.mock.calls[0]?.[0].endedAtMs
    expect(await attempt?.finish("completed")).toBe(false)
    expect(
      await Promise.all([attempt?.retryFinish(), attempt?.retryFinish()]),
    ).toEqual([true, true])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      outcome: "cancelled",
      ...(frozenTime !== undefined ? { endedAtMs: frozenTime } : {}),
    })
    expect(setOperation).toHaveBeenLastCalledWith(
      "session",
      "attempt-1",
      "cancelled",
    )
    expect(await attempt?.retryFinish()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  },
)
it("does not reopen confirmed completion when audit cleanup fails", async () => {
  const attempt = await beginAnalysisAttempt(input as never)
  acknowledge.mockImplementationOnce(() => {
    throw new Error("busy")
  })
  expect(await attempt?.finish("completed")).toBe(true)
  expect(await attempt?.retryFinish()).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
