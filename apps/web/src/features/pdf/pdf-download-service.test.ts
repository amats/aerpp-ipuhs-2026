import { beforeEach, describe, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"

const headersMock = vi.fn()
const readStageMock = vi.fn()
const getSessionMock = vi.fn()
const readEmailFromSessionMock = vi.fn()
const generateConsentPdfMock = vi.fn()
const generateWithdrawalPdfMock = vi.fn()
const readExplanationPdfMock = vi.fn()
const readPlanPdfMock = vi.fn()
const loggerMock = {
  child: vi.fn(() => loggerMock),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
}
const createLoggerMock = vi.fn(() => loggerMock)
const getRequestContextFromHeadersMock = vi.fn(() => ({}))
const logRouteRejectedMock = vi.fn()

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

vi.mock("@/features/app-context/step-state-session", () => ({
  readStageFromSession: readStageMock,
}))

vi.mock("@/features/auth/email", () => ({
  readEmailFromSession: readEmailFromSessionMock,
}))

vi.mock("@/features/pdf/generate-pdf", () => ({
  generateConsentPdf: generateConsentPdfMock,
  generateWithdrawalPdf: generateWithdrawalPdfMock,
}))

vi.mock("@/features/pdf/read-pdf", () => ({
  readExplanationPdf: readExplanationPdfMock,
  readPlanPdf: readPlanPdfMock,
}))

vi.mock("@/lib/logger", () => ({
  createLogger: createLoggerMock,
  getRequestContextFromHeaders: getRequestContextFromHeadersMock,
  logRouteRejected: logRouteRejectedMock,
}))

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
  getSessionForTab: getSessionMock,
}))

describe("pdf-download-service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
    readStageMock.mockImplementation((session) => session.stage)
  })

  it.each([
    ["loadPlanPdf", "pdf.plan.failed", "研究計画書"],
    ["loadConsentPdf", "pdf.consent.failed", "同意書"],
    ["loadWithdrawalPdf", "pdf.withdrawal.failed", "同意撤回書"],
  ] as const)(
    "%s returns a safe failure when session access fails",
    async (actionName, event, label) => {
      const error = new Error("session read failed")
      getSessionMock.mockRejectedValueOnce(error)
      const actions = await import("./pdf-download-service")
      await expect(actions[actionName]()).resolves.toEqual({
        ok: false,
        error: `${label}のダウンロードに失敗しました。時間をおいて再度お試しください。`,
      })
      expect(loggerMock.error).toHaveBeenCalledWith({ error, event })
      expect(readPlanPdfMock).not.toHaveBeenCalled()
      expect(generateConsentPdfMock).not.toHaveBeenCalled()
      expect(generateWithdrawalPdfMock).not.toHaveBeenCalled()
    },
  )

  it("returns the explanation pdf payload when reading succeeds", async () => {
    readExplanationPdfMock.mockResolvedValue(new Uint8Array([1, 2, 3]))

    const { loadExplanationPdf } = await import("./pdf-download-service")

    await expect(loadExplanationPdf()).resolves.toEqual({
      ok: true,
      contentBase64: "AQID",
      filename: "AERPP-Explanation.pdf",
    })
  })

  it("rejects plan downloads outside allowed stages", async () => {
    getSessionMock.mockResolvedValue({ stage: Stage.confirmationSent })

    const { loadPlanPdf } = await import("./pdf-download-service")

    await expect(loadPlanPdf()).resolves.toEqual({
      ok: false,
      error:
        "研究計画書をダウンロードできる状態ではありません。画面の案内を確認してから再度お試しください。",
    })
    expect(logRouteRejectedMock).toHaveBeenCalled()
  })

  it("returns the plan pdf payload for completed participants", async () => {
    getSessionMock.mockResolvedValue({ stage: Stage.followUp })
    readPlanPdfMock.mockResolvedValue(new Uint8Array([4, 5, 6]))

    const { loadPlanPdf } = await import("./pdf-download-service")

    await expect(loadPlanPdf()).resolves.toEqual({
      ok: true,
      contentBase64: "BAUG",
      filename: "AERPP-Plan.pdf",
    })
  })

  it("returns the consent pdf payload when the session allows it", async () => {
    getSessionMock.mockResolvedValue({
      stage: Stage.authenticated,
      consentId: "consent-1",
    })
    readEmailFromSessionMock.mockResolvedValue("user@example.com")
    generateConsentPdfMock.mockResolvedValue({
      documentId: "doc-1",
      pdfBytes: new Uint8Array([7, 8, 9]),
    })

    const { loadConsentPdf } = await import("./pdf-download-service")

    await expect(loadConsentPdf()).resolves.toEqual({
      ok: true,
      contentBase64: "BwgJ",
      filename: "AERPP-Consent.pdf",
    })
  })

  it("returns a failure when the withdrawal email is missing", async () => {
    getSessionMock.mockResolvedValue({
      stage: Stage.withdrawn,
      consentId: "consent-1",
      withdrawalCleanupCompleted: true,
    })
    readEmailFromSessionMock.mockResolvedValue("")

    const { loadWithdrawalPdf } = await import("./pdf-download-service")

    await expect(loadWithdrawalPdf()).resolves.toEqual({
      ok: false,
      error:
        "同意撤回書のダウンロードに必要な情報を確認できませんでした。時間をおいて再度お試しください。",
    })
  })

  it.each([undefined, false, "true", 1])(
    "issues accepted withdrawal receipts independently of deletion completion (%j)",
    async (withdrawalCleanupCompleted) => {
      getSessionMock.mockResolvedValue({
        stage: Stage.withdrawn,
        consentId: "consent-1",
        withdrawalCleanupCompleted,
      })
      readEmailFromSessionMock.mockResolvedValue("user@example.com")
      generateWithdrawalPdfMock.mockResolvedValue({
        documentId: "doc-2",
        pdfBytes: new Uint8Array([10]),
      })
      const { loadWithdrawalPdf } = await import("./pdf-download-service")
      await expect(loadWithdrawalPdf()).resolves.toEqual({
        ok: true,
        contentBase64: "Cg==",
        filename: "AERPP-Withdrawal.pdf",
      })
      expect(generateWithdrawalPdfMock).toHaveBeenCalledWith(
        "user@example.com",
        "consent-1",
      )
    },
  )

  it("returns the withdrawal pdf payload when the session allows it", async () => {
    getSessionMock.mockResolvedValue({
      stage: Stage.withdrawn,
      consentId: "consent-1",
      withdrawalCleanupCompleted: true,
    })
    readEmailFromSessionMock.mockResolvedValue("user@example.com")
    generateWithdrawalPdfMock.mockResolvedValue({
      documentId: "doc-2",
      pdfBytes: new Uint8Array([10, 11, 12]),
    })

    const { loadWithdrawalPdf } = await import("./pdf-download-service")

    await expect(loadWithdrawalPdf()).resolves.toEqual({
      ok: true,
      contentBase64: "CgsM",
      filename: "AERPP-Withdrawal.pdf",
    })
    expect(generateWithdrawalPdfMock).toHaveBeenCalledWith(
      "user@example.com",
      "consent-1",
    )
  })

  it.each([Stage.unauthenticated, Stage.confirmationSent, Stage.authenticated])(
    "rejects a withdrawal receipt without an eligible session or saved request (%s)",
    async (stage) => {
      getSessionMock.mockResolvedValue({ stage, consentId: "consent-1" })
      const { loadWithdrawalPdf } = await import("./pdf-download-service")
      expect((await loadWithdrawalPdf()).ok).toBe(false)
      expect(generateWithdrawalPdfMock).not.toHaveBeenCalled()
    },
  )

  it.each([false, true])(
    "checks durable withdrawal acceptance after a failed stage write (accepted=%s)",
    async (accepted) => {
      const consentId = "SavedConsent00000001"
      getSessionMock.mockResolvedValue({
        stage: Stage.authenticated,
        consentId,
        withdrawalRequest: {
          consentId,
          serverId: "server-id",
          clientId: "client-id",
          pseudonym: "pseudonym-id",
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
          encryptedEmail: "encrypted-email",
        },
      })
      readEmailFromSessionMock.mockResolvedValue("user@example.com")
      if (accepted)
        generateWithdrawalPdfMock.mockResolvedValueOnce({
          documentId: "doc-2",
          pdfBytes: new Uint8Array([10]),
        })
      else
        generateWithdrawalPdfMock.mockRejectedValueOnce(
          new Error("no withdrawal record found"),
        )
      const { loadWithdrawalPdf } = await import("./pdf-download-service")
      expect((await loadWithdrawalPdf()).ok).toBe(accepted)
      expect(generateWithdrawalPdfMock).toHaveBeenCalledWith(
        "user@example.com",
        consentId,
      )
    },
  )
})
