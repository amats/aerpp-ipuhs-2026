import { beforeEach, describe, expect, it, vi } from "vitest"

const getSessionMock = vi.fn()
const readAuthenticationMock = vi.fn()
const isLocallyAuthenticatedMock = vi.fn()
const unsealReceiptMock = vi.fn()
const submitMetadataMock = vi.fn()
const loggerMock = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
}))
vi.mock("@/lib/version", () => ({ APP_VERSION: "1.0.1" }))

vi.mock("@/features/auth/auth-session", () => ({
  readLocalAuthenticationFromSession: readAuthenticationMock,
  isLocallyAuthenticated: isLocallyAuthenticatedMock,
}))

vi.mock("@/features/llm/analysis-receipt", () => ({
  unsealAnalysisCompletionReceipt: unsealReceiptMock,
}))

vi.mock("@/features/identity/participant-identifiers", () => ({
  readPseudonymFromSession: vi.fn(),
}))

vi.mock("@/features/survey/survey-service", () => ({
  recordAnalysisCompletion: submitMetadataMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: vi.fn(() => loggerMock),
}))

const owner = {
  authVerifiedAt: "2026-06-30T00:00:00.000Z",
  clientId: `aerpp:cid-${"c".repeat(32)}`,
  email: "user@example.com",
  pseudonym: `aerpp:pid-${"p".repeat(32)}`,
}

const receipt = {
  analysisId: `aerpp:aid-${"a".repeat(32)}`,
  documentCount: 1,
  documentGraphemeCount: 10,
  analysisWorkspaceVersion: "1.0.0",
  modelName: "test-model",
  ownerClientId: owner.clientId,
  ownerPseudonym: owner.pseudonym,
  processingDurationSeconds: 2,
  resultGraphemeCount: 5,
}

describe("survey actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({
      activeAnalysisId: receipt.analysisId,
      save: vi.fn(),
    })
    readAuthenticationMock.mockResolvedValue(owner)
    isLocallyAuthenticatedMock.mockReturnValue(true)
    unsealReceiptMock.mockResolvedValue(receipt)
    submitMetadataMock.mockResolvedValue(true)
  })

  it("finalizes server-issued metadata and persists its analysis id", async () => {
    const session = {
      activeAnalysisId: receipt.analysisId,
      save: vi.fn(),
    }
    getSessionMock.mockResolvedValue(session)
    const { finalizeAnalysisAction } = await import(
      "./actions-finalize-analysis"
    )

    const result = await finalizeAnalysisAction("sealed-receipt")

    expect(result).toEqual({
      ok: true,
      metadata: {
        analysisId: receipt.analysisId,
        documentCount: 1,
        documentGraphemeCount: 10,
        analysisWorkspaceVersion: "1.0.0",
        modelName: "test-model",
        processingDurationSeconds: 2,
        resultGraphemeCount: 5,
      },
    })
    expect(submitMetadataMock).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        analysisId: receipt.analysisId,
        analysisWorkspaceVersion: receipt.analysisWorkspaceVersion,
      }),
    )
    expect(session).toHaveProperty(
      "lastCompletedAnalysisId",
      receipt.analysisId,
    )
    expect(session.activeAnalysisId).toBeUndefined()
    expect(session.save).toHaveBeenCalledTimes(1)
  })

  it("rejects a receipt issued for another owner", async () => {
    unsealReceiptMock.mockResolvedValue({
      ...receipt,
      ownerClientId: `aerpp:cid-${"x".repeat(32)}`,
    })
    const { finalizeAnalysisAction } = await import(
      "./actions-finalize-analysis"
    )

    await expect(finalizeAnalysisAction("sealed-receipt")).resolves.toEqual({
      ok: false,
      reason: "finalize_failed",
    })
    expect(submitMetadataMock).not.toHaveBeenCalled()
  })

  it.each([false, undefined, null, "false", "true", 1, {}, []])(
    "rejects an unconfirmed authentication decision %j without saving or submitting",
    async (decision) => {
      isLocallyAuthenticatedMock.mockReturnValue(decision)
      const session = await getSessionMock()
      const { finalizeAnalysisAction } = await import(
        "./actions-finalize-analysis"
      )
      expect(await finalizeAnalysisAction("sealed-receipt")).toEqual({
        ok: false,
        reason: "finalize_failed",
      })
      expect(submitMetadataMock).not.toHaveBeenCalled()
      expect(session.activeAnalysisId).toBe(receipt.analysisId)
      expect(session.lastCompletedAnalysisId).toBeUndefined()
      expect(session.save).not.toHaveBeenCalled()
    },
  )

  it.each([false, undefined, null, "false", "true", 1, {}, []])(
    "rejects an unconfirmed completion decision %j without advancing session state",
    async (decision) => {
      submitMetadataMock.mockResolvedValue(decision)
      const session = await getSessionMock()
      const { finalizeAnalysisAction } = await import(
        "./actions-finalize-analysis"
      )
      expect(await finalizeAnalysisAction("sealed-receipt")).toEqual({
        ok: false,
        reason: "finalize_failed",
      })
      expect(session.activeAnalysisId).toBe(receipt.analysisId)
      expect(session.lastCompletedAnalysisId).toBeUndefined()
      expect(session.save).not.toHaveBeenCalled()
    },
  )

  it("rejects a replayed completion receipt", async () => {
    getSessionMock.mockResolvedValue({
      activeAnalysisId: receipt.analysisId,
      lastCompletedAnalysisId: receipt.analysisId,
      save: vi.fn(),
    })
    const { finalizeAnalysisAction } = await import(
      "./actions-finalize-analysis"
    )

    await expect(finalizeAnalysisAction("sealed-receipt")).resolves.toEqual({
      ok: false,
      reason: "finalize_failed",
    })
    expect(submitMetadataMock).not.toHaveBeenCalled()
  })

  it("returns the same metadata after a committed response is lost without resubmitting", async () => {
    const { finalizeAnalysisAction } = await import(
      "./actions-finalize-analysis"
    )
    const first = await finalizeAnalysisAction("sealed-receipt")
    expect(first.ok).toBe(true)
    expect(await finalizeAnalysisAction("sealed-receipt")).toEqual(first)
    expect(submitMetadataMock).toHaveBeenCalledTimes(1)
  })

  it.each(["another-active", "another-completed"])(
    "rejects old completion retries after %s analysis",
    async (scenario) => {
      getSessionMock.mockResolvedValue({
        activeAnalysisId:
          scenario === "another-active"
            ? `aerpp:aid-${"b".repeat(32)}`
            : undefined,
        lastCompletedAnalysisId:
          scenario === "another-completed"
            ? `aerpp:aid-${"b".repeat(32)}`
            : receipt.analysisId,
        save: vi.fn(),
      })
      const { finalizeAnalysisAction } = await import(
        "./actions-finalize-analysis"
      )
      expect(await finalizeAnalysisAction("sealed-receipt")).toEqual({
        ok: false,
        reason: "finalize_failed",
      })
      expect(submitMetadataMock).not.toHaveBeenCalled()
    },
  )
})

// Admission has dedicated authority tests and real-cookie browser coverage.
vi.mock("@/features/session/session-operation", () => ({
  withSessionOperation: (
    _token: unknown,
    _kind: string,
    operation: () => Promise<unknown>,
  ) => operation(),
}))
