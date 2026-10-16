import { beforeEach, describe, expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"
import { LOG_EVENT } from "@/lib/logger-events"

const unsealMock = vi.fn()
const sealMock = vi.fn()
vi.mock("@/lib/session-seal", () => ({
  sealSessionData: sealMock,
  unsealSessionData: unsealMock,
}))
const headersMock = vi.fn()
const encryptEmailMock = vi.fn()
const readEmailFromSessionMock = vi.fn()
const writeEmailToSessionMock = vi.fn()
const createClientIdMock = vi.fn()
const getClientIdMock = vi.fn()
const getPseudonymMock = vi.fn()
const fetchWithRetryMock = vi.fn()
const getSessionMock = vi.fn()
const loggerMock = {
  child: vi.fn(() => loggerMock),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}
const createLoggerMock = vi.fn(() => loggerMock)
const getRequestContextFromHeadersMock = vi.fn(() => ({}))

vi.mock("next/headers", () => ({
  headers: headersMock,
}))

vi.mock("@/features/auth/email", () => ({
  encryptEmail: encryptEmailMock,
  readEmailFromSession: readEmailFromSessionMock,
  writeEmailToSession: writeEmailToSessionMock,
}))

vi.mock("@/features/identity/participant-identifiers", () => ({
  createClientId: createClientIdMock,
  createPseudonym: () => "psn_123",
  readClientIdFromSession: getClientIdMock,
  readPseudonymFromSession: getPseudonymMock,
}))

vi.mock("@aerpp/config/server/web", () => ({
  env: {
    receptionExpiresAt: new Date("2099-01-01T00:00:00Z"),
    participantApiServerId: "server-id",
    supportApiCredential: "magic-key",
    sendMagicLinkUrl: "https://example.com/send",
    verifyAuthenticationUrl: "https://example.com/verify",
    withdrawParticipationUrl: "https://example.com/withdraw",
    listParticipationEventsUrl: "https://example.com/records",
    getParticipationStateUrl: "https://example.com/state",
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

describe("auth-service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
  })

  it("checks administrator recovery through the state-only endpoint", async () => {
    const { hasPendingAdminRecovery } = await import("./auth-service")
    const recovery = {
      recoveryId: "11111111-1111-4111-8111-111111111111",
      destination: "follow-up-document",
    }
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({
        studyGeneration: null,
        lastWithdrawalId: null,
        pendingRecovery: recovery,
      }),
    )
    expect(
      await hasPendingAdminRecovery({ pseudonym: "psn_123" } as never),
    ).toBe(true)
    expect(fetchWithRetryMock.mock.calls[0][0]).toBe(
      "https://example.com/state",
    )
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({ studyGeneration: null, lastWithdrawalId: null }),
    )
    expect(
      await hasPendingAdminRecovery({ pseudonym: "psn_123" } as never),
    ).toBe(false)
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({ error: "unavailable" }, { status: 503 }),
    )
    await expect(
      hasPendingAdminRecovery({ pseudonym: "psn_123" } as never),
    ).rejects.toThrow("Recovery verification unavailable")
  })

  it("sendMagicLinkEmail rejects blank email before calling dependencies", async () => {
    const { sendMagicLinkEmail } = await import("./auth-service")

    const result = await sendMagicLinkEmail({} as never, "   ")

    expect(result).toEqual({ ok: false, reason: "send_failed" })
    expect(writeEmailToSessionMock).not.toHaveBeenCalled()
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("keeps checking the recovery participant after an expired email correction clears ordinary identity", async () => {
    const { hasPendingAdminRecovery } = await import("./auth-service")
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({
        studyGeneration: null,
        lastWithdrawalId: null,
        pendingRecovery: {
          recoveryId: "11111111-1111-4111-8111-111111111111",
          destination: "initial-document",
        },
      }),
    )
    expect(
      await hasPendingAdminRecovery({
        adminRecoveryPseudonym: "psn_123",
      } as never),
    ).toBe(true)
    expect(JSON.parse(fetchWithRetryMock.mock.calls[0][1].body)).toEqual({
      pseudonym: "psn_123",
    })
  })

  it("sendMagicLinkEmail stores normalized identity on success", async () => {
    const session = {
      consentId: "SendConsentRequest01",
      clientId: "client_123",
      pseudonym: "psn_123",
      save: vi.fn(),
      preparedConsentContext: "sealed-context",
      coordinationId: "session-1",
    }
    unsealMock.mockResolvedValue({
      purpose: "consent",
      coordinationId: "session-1",
      email: "user@example.com",
      expectedWithdrawalId: null,
      expectedRecoveryId: null,
      expectedStudyGeneration: null,
      consentId: "SendConsentRequest01",
      expiresAtMs: Date.now() + 3600000,
      serverId: "server-id",
      clientId: "client_123",
      pseudonym: "psn_123",
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      encryptedEmail: "sealed-email",
    })
    writeEmailToSessionMock.mockResolvedValue("psn_123")
    encryptEmailMock.mockResolvedValue("sealed-email")
    getClientIdMock.mockResolvedValue("client_123")
    fetchWithRetryMock.mockResolvedValue(
      Response.json({
        ok: true,
        deletedCount: 0,
        hasCompletedAnalysis: false,
        consentId: "SendConsentRequest01",
      }),
    )

    const { sendMagicLinkEmail } = await import("./auth-service")

    const result = await sendMagicLinkEmail(
      session as never,
      "  USER@example.com ",
      "sealed-context",
    )

    expect(result).toEqual({ ok: true })
    expect(writeEmailToSessionMock).toHaveBeenCalledWith(
      session,
      "user@example.com",
    )
    expect(encryptEmailMock).not.toHaveBeenCalled()
    expect(JSON.parse(fetchWithRetryMock.mock.calls[0][1].body)).toMatchObject({
      consentId: "SendConsentRequest01",
      clientId: "client_123",
      pseudonym: "psn_123",
      email: "user@example.com",
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      encryptedEmail: "sealed-email",
      expectedWithdrawalId: null,
      expectedRecoveryId: null,
      expectedStudyGeneration: null,
    })
    expect(session).toMatchObject({ clientId: "client_123" })
  })

  it("verifyAuthentication returns success and the authoritative mode after upstream verification", async () => {
    const session: {
      consentId: string
      authVerifiedAt?: string
      save: ReturnType<typeof vi.fn>
    } = { consentId: "SendConsentRequest01", save: vi.fn() }
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue("psn_123")
    fetchWithRetryMock.mockResolvedValue(
      Response.json({
        ok: true,
        questionnaireKind: "initial",
        deletedCount: 0,
        hasCompletedAnalysis: false,
        consentId: "SendConsentRequest01",
      }),
    )

    const { verifyAuthentication } = await import("./auth-service")

    const result = await verifyAuthentication(session as never)

    expect(result).toEqual({
      ok: true,
      authVerifiedAt: expect.any(String),
    })
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      "https://example.com/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          serverId: "server-id",
          clientId: "client_123",
          pseudonym: "psn_123",
          consentId: "SendConsentRequest01",
        }),
      }),
      expect.any(Object),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.authVerifiedAt).toBe(session.authVerifiedAt)
    }
    expect(session.authVerifiedAt).toEqual(expect.any(String))
    expect(session.save).not.toHaveBeenCalled()
  })

  it.each([undefined, null, "invalid"])(
    "rejects verification without a valid study mode (%j)",
    async (questionnaireKind) => {
      getClientIdMock.mockResolvedValue("client_123")
      getPseudonymMock.mockResolvedValue("psn_123")
      fetchWithRetryMock.mockResolvedValue(
        Response.json({ ok: true, questionnaireKind }),
      )
      const session = { consentId: "SendConsentRequest01" }
      const { verifyAuthentication } = await import("./auth-service")
      expect(await verifyAuthentication(session as never)).toEqual({
        ok: false,
        reason: "auth_unavailable",
      })
      expect(session).not.toHaveProperty("authVerifiedAt")
      expect(session).not.toHaveProperty("questionnaireKind")
    },
  )

  it("verifyAuthentication rejects when client id is unavailable", async () => {
    getClientIdMock.mockResolvedValue(null)
    getPseudonymMock.mockResolvedValue("psn_123")
    fetchWithRetryMock.mockResolvedValue(
      Response.json({
        ok: true,
        deletedCount: 0,
        hasCompletedAnalysis: false,
        consentId: "SendConsentRequest01",
      }),
    )

    const { verifyAuthentication } = await import("./auth-service")

    const result = await verifyAuthentication({} as never)

    expect(result).toEqual({ ok: false, reason: "auth_invalid" })
  })

  it("verifyAuthentication rejects when pseudonym is unavailable", async () => {
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue(null)

    const { verifyAuthentication } = await import("./auth-service")

    const result = await verifyAuthentication({} as never)

    expect(result).toEqual({ ok: false, reason: "auth_invalid" })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it.each([Stage.unauthenticated, Stage.confirmationSent])(
    "withdrawParticipation rejects requests from %s stage",
    async (stage) => {
      const session = {
        consentId: "SendConsentRequest01",
        save: vi.fn(),
        stage,
      }

      const { withdrawParticipation } = await import("./auth-service")

      const result = await withdrawParticipation(
        session as never,
        "user@example.com",
      )

      expect(result).toEqual({ ok: false, reason: "stage_mismatch" })
      expect(fetchWithRetryMock).not.toHaveBeenCalled()
    },
  )

  it("withdrawParticipation rejects when the provided email does not match the session email", async () => {
    const session = {
      consentId: "SendConsentRequest01",
      save: vi.fn(),
      stage: Stage.authenticated,
    }
    readEmailFromSessionMock.mockResolvedValue("stored@example.com")

    const { withdrawParticipation } = await import("./auth-service")

    const result = await withdrawParticipation(
      session as never,
      "other@example.com",
    )

    expect(result).toEqual({ ok: false, reason: "email_mismatch" })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it("withdrawParticipation uses existing pseudonym on success", async () => {
    const session = {
      consentId: "SendConsentRequest01",
      save: vi.fn(),
      stage: Stage.authenticated,
    }
    readEmailFromSessionMock.mockResolvedValue("stored@example.com")
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue("psn_existing")
    encryptEmailMock.mockResolvedValue("sealed-email")
    fetchWithRetryMock.mockResolvedValue(
      Response.json({
        ok: true,
        deletedCount: 0,
        hasCompletedAnalysis: false,
        consentId: "SendConsentRequest01",
      }),
    )

    const { withdrawParticipation } = await import("./auth-service")

    const result = await withdrawParticipation(
      session as never,
      " STORED@example.com ",
    )

    expect(result).toEqual({
      ok: true,
      cleanupPending: false,
      hasCompletedAnalysis: false,
    })
    expect(getPseudonymMock).toHaveBeenCalledTimes(1)
    expect(fetchWithRetryMock).toHaveBeenCalledWith(
      "https://example.com/withdraw",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          serverId: "server-id",
          clientId: "client_123",
          pseudonym: "psn_existing",
          consentId: "SendConsentRequest01",
          encryptedEmail: "sealed-email",
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
        }),
      }),
      expect.any(Object),
    )
    expect(encryptEmailMock).toHaveBeenCalledWith("stored@example.com")
    expect(session.stage).toBe(Stage.authenticated)
    expect(session.save).toHaveBeenCalledTimes(1)
  })

  it("withdrawParticipation fails when encrypting the verified email fails", async () => {
    const session = {
      consentId: "SendConsentRequest01",
      save: vi.fn(),
      stage: Stage.authenticated,
    }
    readEmailFromSessionMock.mockResolvedValue("stored@example.com")
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue("psn_existing")
    encryptEmailMock.mockResolvedValue(null)

    const { withdrawParticipation } = await import("./auth-service")

    const result = await withdrawParticipation(
      session as never,
      "stored@example.com",
    )

    expect(result).toEqual({ ok: false, reason: "withdraw_failed" })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
    expect(session.save).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "listParticipationEvents handles incomplete history (requireComplete=%s)",
    async (requireComplete) => {
      getPseudonymMock.mockResolvedValue("psn_123")
      fetchWithRetryMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            records: [
              {
                id: "consent-record",
                consentId: "consent-record",
                precedingWithdrawalId: "withdrawal-record",
                eventType: "consent",
                serverId: "server-id",
                clientId: "client_123",
                pseudonym: "psn_123",
                documentSet: { version: "1.0", sha256: "a".repeat(64) },
                encryptedEmail: "sealed-email",
                consentConfirmedAt: "2026-03-20T01:02:03.000Z",
              },
              {
                id: "withdrawal-record",
                eventType: "withdrawal",
                serverId: "",
                clientId: "client_123",
                pseudonym: "psn_123",
                documentSet: { version: "1.0", sha256: "a".repeat(64) },
                encryptedEmail: "sealed-email",
                withdrawalAcceptedAt: "2026-03-21T01:02:03.000Z",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )

      const { listParticipationEvents } = await import("./auth-service")

      const result = await listParticipationEvents("psn_123", {
        requireComplete,
      })

      if (requireComplete === true) {
        expect(result).toEqual([])
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ invalidCount: 1, outcome: "failed" }),
        )
        return
      }

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: "consent-record",
        consentId: "consent-record",
        precedingWithdrawalId: "withdrawal-record",
        eventType: "consent",
        clientId: "client_123",
        pseudonym: "psn_123",
      })
      expect(result[0]?.eventAt).toBeInstanceOf(Date)
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          invalidCount: 1,
          outcome: "partial",
        }),
      )
    },
  )

  it("listParticipationEvents returns an empty list for invalid payload shape", async () => {
    fetchWithRetryMock.mockResolvedValue(
      new Response(JSON.stringify({ records: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { listParticipationEvents } = await import("./auth-service")

    await expect(listParticipationEvents("psn_123")).resolves.toEqual([])
  })

  it.each([
    [200, null],
    [200, { ok: false }],
    [202, { ok: true }],
    [204, null],
    [200, "<html>error</html>"],
  ])(
    "does not authenticate from invalid success status/body %s %j",
    async (status, body) => {
      const session = { consentId: "SendConsentRequest01", save: vi.fn() }
      getClientIdMock.mockResolvedValue("client_123")
      getPseudonymMock.mockResolvedValue("psn_123")
      fetchWithRetryMock.mockResolvedValue(
        new Response(body === null ? null : JSON.stringify(body), { status }),
      )
      const { verifyAuthentication } = await import("./auth-service")
      expect(await verifyAuthentication(session as never)).toEqual({
        ok: false,
        reason: "auth_unavailable",
      })
      expect(session).not.toHaveProperty("authVerifiedAt")
    },
  )

  it.each([
    [503, "WITHDRAWAL_CLEANUP_PENDING", true],
    [500, "WITHDRAWAL_CLEANUP_FAILED", true],
    [500, "INTERNAL_ERROR", false],
    [403, "WITHDRAWAL_CLEANUP_PENDING", false],
    [503, "UNKNOWN", false],
  ])(
    "distinguishes committed withdrawal for %s %s",
    async (status, code, committed) => {
      const session = {
        consentId: "SendConsentRequest01",
        save: vi.fn(),
        stage: Stage.authenticated,
      }
      readEmailFromSessionMock.mockResolvedValue("stored@example.com")
      getClientIdMock.mockResolvedValue("client_123")
      getPseudonymMock.mockResolvedValue("psn_existing")
      encryptEmailMock.mockResolvedValue("sealed-email")
      fetchWithRetryMock.mockResolvedValue(
        Response.json({ error: "failure", code }, { status }),
      )
      const { withdrawParticipation } = await import("./auth-service")
      expect(
        await withdrawParticipation(session as never, "stored@example.com"),
      ).toEqual(
        committed
          ? { ok: true, cleanupPending: true }
          : { ok: false, reason: "withdraw_failed" },
      )
    },
  )

  it.each(["verify", "withdraw"] as const)(
    "records %s protocol failure without response content when HTTP 200 has an invalid success shape",
    async (operation) => {
      const session = {
        consentId: "SendConsentRequest01",
        save: vi.fn(),
        stage: Stage.authenticated,
      }
      readEmailFromSessionMock.mockResolvedValue("stored@example.com")
      getClientIdMock.mockResolvedValue("client_123")
      getPseudonymMock.mockResolvedValue("psn_existing")
      encryptEmailMock.mockResolvedValue("sealed-email")
      fetchWithRetryMock.mockResolvedValueOnce(
        Response.json({ ok: true, privateBody: "synthetic-private-response" }),
      )
      const { verifyAuthentication, withdrawParticipation } = await import(
        "./auth-service"
      )
      const result =
        operation === "verify"
          ? await verifyAuthentication(session as never)
          : await withdrawParticipation(session as never, "stored@example.com")
      expect(result).toEqual({
        ok: false,
        reason: operation === "verify" ? "auth_unavailable" : "withdraw_failed",
      })
      expect(loggerMock.error).toHaveBeenCalledExactlyOnceWith({
        event:
          operation === "verify"
            ? LOG_EVENT.authVerifyFailed
            : LOG_EVENT.authWithdrawFailed,
        operation: "response_schema",
        outcome: "failed",
        statusCode: 200,
      })
      expect(JSON.stringify(loggerMock.error.mock.calls)).not.toContain(
        "synthetic-private-response",
      )
      expect(session).not.toHaveProperty("authVerifiedAt")
    },
  )

  it("retries a lost withdrawal response with the original saved request from withdrawn state", async () => {
    const session = {
      consentId: "SendConsentRequest01",
      save: vi.fn(),
      stage: Stage.authenticated as Stage,
    }
    readEmailFromSessionMock.mockResolvedValue("stored@example.com")
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue("psn_existing")
    encryptEmailMock.mockResolvedValue("original-ciphertext")
    fetchWithRetryMock.mockRejectedValueOnce(new TypeError("connection lost"))
    const { withdrawParticipation } = await import("./auth-service")
    expect(
      (await withdrawParticipation(session as never, "stored@example.com")).ok,
    ).toBe(false)
    session.stage = Stage.withdrawn
    encryptEmailMock.mockResolvedValue(null)
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({ ok: true, deletedCount: 5, hasCompletedAnalysis: true }),
    )
    expect(
      await withdrawParticipation(session as never, "stored@example.com"),
    ).toEqual({ ok: true, cleanupPending: false, hasCompletedAnalysis: true })
    expect(fetchWithRetryMock.mock.calls[0][1].body).toBe(
      fetchWithRetryMock.mock.calls[1][1].body,
    )
    expect(encryptEmailMock).toHaveBeenCalledTimes(1)
    expect(session.save).toHaveBeenCalledTimes(1)
  })

  it("does not send withdrawal if the prepared request cannot be saved", async () => {
    const session = {
      consentId: "SendConsentRequest01",
      save: vi.fn(async () => {
        throw new Error("cookie write")
      }),
      stage: Stage.authenticated,
    }
    readEmailFromSessionMock.mockResolvedValue("stored@example.com")
    getClientIdMock.mockResolvedValue("client_123")
    getPseudonymMock.mockResolvedValue("psn_existing")
    encryptEmailMock.mockResolvedValue("sealed-email")
    const { withdrawParticipation } = await import("./auth-service")
    expect(
      (await withdrawParticipation(session as never, "stored@example.com")).ok,
    ).toBe(false)
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })
})

describe("consent history binding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unsealMock.mockReset()
    sealMock.mockReset()
    fetchWithRetryMock.mockReset()
  })
  const session = {
    coordinationId: "session-1",
    consentId: "SendConsentRequest01",
    clientId: "client_123",
    pseudonym: "psn_123",
    preparedConsentContext: "context",
    save: vi.fn(),
  }
  const snapshot = {
    purpose: "consent",
    coordinationId: "session-1",
    email: "user@example.com",
    expectedWithdrawalId: "withdrawal-1",
    expectedRecoveryId: null,
    expectedStudyGeneration: null,
    consentId: "SendConsentRequest01",
    expiresAtMs: Date.now() + 3600000,
    serverId: "server-id",
    clientId: "client_123",
    pseudonym: "psn_123",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    encryptedEmail: "sealed-email",
  }
  beforeEach(() =>
    Object.assign(session, {
      consentId: snapshot.consentId,
      clientId: snapshot.clientId,
      pseudonym: snapshot.pseudonym,
      preparedConsentContext: "context",
      lastConsentMailAt: undefined,
      lastConsentMailId: undefined,
    }),
  )
  it.each([
    "consentId",
    "clientId",
    "pseudonym",
    "preparedConsentContext",
  ] as const)(
    "rejects a different tab's %s before sending mail",
    async (field) => {
      unsealMock.mockResolvedValueOnce(snapshot)
      const { sendMagicLinkEmail } = await import("./auth-service")
      expect(
        await sendMagicLinkEmail(
          { ...session, [field]: "other-tab-value" } as never,
          "user@example.com",
          "context",
        ),
      ).toEqual({ ok: false, reason: "consent_context_invalid" })
      expect(fetchWithRetryMock).not.toHaveBeenCalled()
      expect(writeEmailToSessionMock).not.toHaveBeenCalled()
    },
  )
  it("persists a sealed email/session-bound request before sending", async () => {
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({
        studyGeneration: null,
        lastWithdrawalId: "withdrawal-1",
      }),
    )
    sealMock.mockResolvedValueOnce("sealed-context")
    const { prepareConsentForEmail } = await import("./auth-service")
    expect(
      await prepareConsentForEmail(session as never, " USER@example.com "),
    ).toEqual({ ok: true, consentContext: "sealed-context" })
    expect(sealMock).toHaveBeenCalledWith({
      ...snapshot,
      consentId: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
      expiresAtMs: expect.any(Number),
    })
    expect(session.save).toHaveBeenCalledOnce()
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1)
    expect(fetchWithRetryMock.mock.calls[0][0]).toBe(
      "https://example.com/state",
    )
    expect(writeEmailToSessionMock).not.toHaveBeenCalled()
  })

  it("retains the mail interval after recipient correction without dispatching", async () => {
    const pending = {
      ...session,
      stage: Stage.unauthenticated,
      lastConsentMailAt: Date.now(),
      lastConsentMailId: "PreviousConsentId001",
    }
    unsealMock.mockResolvedValueOnce(snapshot)
    const { sendMagicLinkEmail } = await import("./auth-service")
    expect(
      await sendMagicLinkEmail(pending as never, "user@example.com", "context"),
    ).toEqual({ ok: false, reason: "send_rate_limited" })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
    expect(writeEmailToSessionMock).not.toHaveBeenCalled()
  })

  it("renews an expired preparation during explicit consent rechecking", async () => {
    const expired = { ...snapshot, expiresAtMs: Date.now() - 1 }
    unsealMock.mockResolvedValueOnce(expired)
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({
        studyGeneration: snapshot.expectedStudyGeneration,
        lastWithdrawalId: snapshot.expectedWithdrawalId,
      }),
    )
    sealMock.mockResolvedValueOnce("renewed-context")
    const restored = { ...session, save: vi.fn() }
    const { prepareConsentForEmail } = await import("./auth-service")
    expect(
      await prepareConsentForEmail(restored as never, snapshot.email),
    ).toEqual({ ok: true, consentContext: "renewed-context" })
    expect(sealMock).toHaveBeenCalledOnce()
    const prepared = sealMock.mock.calls[0][0]
    expect(prepared.consentId).not.toBe(expired.consentId)
    expect(prepared.expiresAtMs).toBeGreaterThan(Date.now())
    expect(restored.save).toHaveBeenCalledOnce()
  })

  it("permits corrected consent after the server mail interval has elapsed", async () => {
    const pending = {
      ...session,
      stage: Stage.unauthenticated,
      lastConsentMailAt: Date.now() - 61_000,
      lastConsentMailId: "PreviousConsentId001",
    }
    unsealMock.mockResolvedValueOnce(snapshot)
    writeEmailToSessionMock.mockResolvedValueOnce("psn_123")
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({ ok: true, consentId: snapshot.consentId }),
    )
    const { sendMagicLinkEmail } = await import("./auth-service")
    expect(
      await sendMagicLinkEmail(pending as never, "user@example.com", "context"),
    ).toEqual({ ok: true })
    expect(fetchWithRetryMock).toHaveBeenCalledOnce()
    expect(pending.lastConsentMailId).toBe(snapshot.consentId)
  })
  it("does not treat unavailable or old-format history as no withdrawal", async () => {
    const { prepareConsentForEmail } = await import("./auth-service")
    for (const response of [
      Response.json({ records: [] }),
      Response.json({ error: "unavailable" }, { status: 503 }),
      Response.json({ error: "absent" }, { status: 404 }),
    ]) {
      fetchWithRetryMock.mockResolvedValueOnce(response)
      expect(
        (await prepareConsentForEmail(session as never, "user@example.com")).ok,
      ).toBe(false)
    }
  })
  it.each([
    null,
    { ...snapshot, coordinationId: "other-session" },
    { ...snapshot, email: "other@example.com" },
    { ...snapshot, purpose: "another" },
  ])(
    "rejects invalid or mismatched sealed context before sending (%j)",
    async (value) => {
      unsealMock.mockResolvedValueOnce(value)
      const { sendMagicLinkEmail } = await import("./auth-service")
      expect(
        await sendMagicLinkEmail(
          session as never,
          "user@example.com",
          "context",
        ),
      ).toEqual({ ok: false, reason: "consent_context_invalid" })
      expect(fetchWithRetryMock).not.toHaveBeenCalled()
    },
  )
  it("rejects a superseded snapshot without fetching or retrying with a fresh boundary", async () => {
    unsealMock.mockResolvedValueOnce(snapshot)
    writeEmailToSessionMock.mockResolvedValueOnce("psn_123")
    encryptEmailMock.mockResolvedValueOnce("sealed-email")
    getClientIdMock.mockResolvedValueOnce("client_123")
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json(
        { error: "superseded", code: "CONSENT_SUPERSEDED" },
        { status: 409 },
      ),
    )
    const { sendMagicLinkEmail } = await import("./auth-service")
    expect(
      await sendMagicLinkEmail(session as never, "user@example.com", "context"),
    ).toEqual({ ok: false, reason: "consent_superseded" })
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(fetchWithRetryMock.mock.calls[0][1].body).expectedWithdrawalId,
    ).toBe("withdrawal-1")
  })
  it("reuses persisted preparation after reload and sends identical content after response loss", async () => {
    const restored = {
      stage: "unauthenticated",
      coordinationId: "session-1",
      consentId: "SendConsentRequest01",
      clientId: "client_123",
      pseudonym: "psn_123",
      preparedConsentContext: "persisted",
      save: vi.fn(),
    }
    unsealMock.mockResolvedValue(snapshot)
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({
        studyGeneration: null,
        lastWithdrawalId: "withdrawal-1",
      }),
    )
    const { prepareConsentForEmail, sendMagicLinkEmail } = await import(
      "./auth-service"
    )
    expect(
      await prepareConsentForEmail(restored as never, "user@example.com"),
    ).toEqual({ ok: true, consentContext: "persisted" })
    expect(sealMock).not.toHaveBeenCalled()
    expect(restored.save).not.toHaveBeenCalled()
    writeEmailToSessionMock.mockResolvedValue("psn_123")
    fetchWithRetryMock.mockRejectedValueOnce(new Error("response lost"))
    expect(
      await sendMagicLinkEmail(
        restored as never,
        "user@example.com",
        "persisted",
      ),
    ).toEqual({ ok: false, reason: "send_failed" })
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({ ok: true, consentId: snapshot.consentId }),
    )
    expect(
      await sendMagicLinkEmail(
        { ...restored } as never,
        "user@example.com",
        "persisted",
      ),
    ).toEqual({ ok: true })
    expect(fetchWithRetryMock.mock.calls[1][1].body).toBe(
      fetchWithRetryMock.mock.calls[2][1].body,
    )
  })
  const recoveryId = "11111111-1111-4111-8111-111111111111"
  function consumedRecovery() {
    const original = { ...snapshot, expectedRecoveryId: recoveryId }
    const restored = {
      ...session,
      stage: Stage.unauthenticated,
      adminRecoveryId: recoveryId,
      adminRecoveryPseudonym: snapshot.pseudonym,
      lastConsentMailId: snapshot.consentId,
    }
    unsealMock.mockResolvedValue(original)
    getClientIdMock.mockResolvedValue(snapshot.clientId)
    getPseudonymMock.mockResolvedValue(snapshot.pseudonym)
    return { original, restored }
  }
  function consumedState(fields: object = {}) {
    return Response.json({
      studyGeneration: recoveryId,
      lastWithdrawalId: snapshot.expectedWithdrawalId,
      ...fields,
    })
  }
  it.each(["pending-deadline", "expired-deadline", "changed-documents"])(
    "reuses confirmed recovery without renewing identity or authentication during preparation: %s",
    async (mode) => {
      const { original, restored } = consumedRecovery()
      if (mode === "expired-deadline") original.expiresAtMs = Date.now() - 1
      if (mode === "changed-documents")
        original.documentSet = { version: "0.9", sha256: "b".repeat(64) }
      fetchWithRetryMock
        .mockResolvedValueOnce(consumedState())
        .mockResolvedValueOnce(
          Response.json({ ok: true, questionnaireKind: "initial" }),
        )
      const before = { ...restored }
      const { prepareConsentForEmail } = await import("./auth-service")
      expect(
        await prepareConsentForEmail(restored as never, snapshot.email),
      ).toEqual({ ok: true, consentContext: "context" })
      expect(restored).toEqual(before)
      expect(sealMock).not.toHaveBeenCalled()
      expect(restored.save).not.toHaveBeenCalled()
      expect(fetchWithRetryMock).toHaveBeenCalledTimes(2)
      expect(JSON.parse(fetchWithRetryMock.mock.calls[1][1].body)).toEqual({
        consentId: snapshot.consentId,
        clientId: snapshot.clientId,
        pseudonym: snapshot.pseudonym,
        serverId: snapshot.serverId,
      })
    },
  )
  it.each([
    { status: 409, body: { error: "synthetic", code: "CONSENT_SUPERSEDED" } },
    {
      status: 409,
      body: { error: "synthetic", code: "AUTHENTICATION_PENDING" },
    },
    {
      status: 401,
      body: { error: "synthetic", code: "AUTHENTICATION_EXPIRED" },
    },
    { status: 503, body: { error: "synthetic", code: "INTERNAL_ERROR" } },
    ...[false, null, undefined, "false", 1, {}, []].map((ok) => ({
      status: 200,
      body: { ok, questionnaireKind: "initial" },
    })),
  ])(
    "rejects unconfirmed recovery owner proof: $status $body",
    async ({ status, body }) => {
      const { restored } = consumedRecovery()
      fetchWithRetryMock
        .mockResolvedValueOnce(consumedState())
        .mockResolvedValueOnce(Response.json(body, { status }))
      const { prepareConsentForEmail } = await import("./auth-service")
      expect(
        await prepareConsentForEmail(restored as never, snapshot.email),
      ).toEqual({
        ok: false,
        reason: "consent_context_failed",
      })
      expect(sealMock).not.toHaveBeenCalled()
      expect(restored.save).not.toHaveBeenCalled()
      expect(fetchWithRetryMock).toHaveBeenCalledTimes(2)
    },
  )
  it.each([
    "not-dispatched",
    "different-session",
    "different-client",
    "different-email",
    "different-consent",
    "different-grant",
    "replaced-grant",
    "different-generation",
    "withdrawal",
  ])("does not reconcile a mismatched recovery request: %s", async (mode) => {
    const { original, restored } = consumedRecovery()
    const otherId = "22222222-2222-4222-8222-222222222222"
    if (mode === "not-dispatched")
      restored.lastConsentMailId = "OtherConsent00000001"
    if (mode === "different-session") original.coordinationId = "other-session"
    if (mode === "different-client") original.clientId = "other-client"
    if (mode === "different-email") original.email = "other@example.com"
    if (mode === "different-consent")
      original.consentId = "OtherConsent00000001"
    if (mode === "different-grant") original.expectedRecoveryId = otherId
    fetchWithRetryMock.mockResolvedValueOnce(
      consumedState(
        mode === "replaced-grant"
          ? {
              pendingRecovery: {
                recoveryId: otherId,
                destination: "initial-document",
              },
            }
          : mode === "different-generation"
            ? { studyGeneration: otherId }
            : mode === "withdrawal"
              ? { lastWithdrawalId: "withdrawal-2" }
              : {},
      ),
    )
    const { prepareConsentForEmail } = await import("./auth-service")
    expect(
      await prepareConsentForEmail(restored as never, snapshot.email),
    ).toEqual({
      ok: false,
      reason: "consent_context_failed",
    })
    expect(sealMock).not.toHaveBeenCalled()
    expect(restored.save).not.toHaveBeenCalled()
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1)
  })
  it("does not expose a prepared token when its durable save fails", async () => {
    unsealMock.mockResolvedValue(null)
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({ studyGeneration: null, lastWithdrawalId: null }),
    )
    getClientIdMock.mockResolvedValue("client_123")
    encryptEmailMock.mockResolvedValue("sealed-email")
    sealMock.mockResolvedValue("new-context")
    const { prepareConsentForEmail } = await import("./auth-service")
    expect(
      await prepareConsentForEmail(
        {
          coordinationId: "session-1",
          save: vi.fn().mockRejectedValue(new Error("save failed")),
        } as never,
        "user@example.com",
      ),
    ).toEqual({ ok: false, reason: "consent_context_failed" })
    expect(fetchWithRetryMock).toHaveBeenCalledOnce()
  })
  it("preserves a dispatched older set through preparation and an uncertain retry after deployment", async () => {
    const original = {
      ...snapshot,
      documentSet: { version: "0.9", sha256: "b".repeat(64) },
    }
    const restored = {
      ...session,
      stage: Stage.unauthenticated,
      lastConsentMailId: snapshot.consentId,
    }
    unsealMock.mockResolvedValue(original)
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({
        studyGeneration: null,
        lastWithdrawalId: "withdrawal-1",
      }),
    )
    const { prepareConsentForEmail, sendMagicLinkEmail } = await import(
      "./auth-service"
    )
    expect(
      await prepareConsentForEmail(
        restored as never,
        snapshot.email,
        original.documentSet.sha256,
      ),
    ).toEqual({ ok: true, consentContext: "context" })
    writeEmailToSessionMock.mockResolvedValue("psn_123")
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json({ ok: true, consentId: snapshot.consentId }),
    )
    expect(
      await sendMagicLinkEmail(restored as never, snapshot.email, "context"),
    ).toEqual({ ok: true })
    expect(
      JSON.parse(fetchWithRetryMock.mock.calls[1][1].body).documentSet,
    ).toEqual(original.documentSet)
    expect(sealMock).not.toHaveBeenCalled()
  })
  it("rejects an undispatched prepared set after deployment without sending mail", async () => {
    unsealMock.mockResolvedValue({
      ...snapshot,
      documentSet: { version: "0.9", sha256: "b".repeat(64) },
    })
    const { sendMagicLinkEmail } = await import("./auth-service")
    expect(
      await sendMagicLinkEmail(session as never, snapshot.email, "context"),
    ).toEqual({ ok: false, reason: "document_set_changed" })
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })
  it.each([
    [409, "AUTHENTICATION_PENDING", "not_verified"],
    [401, "AUTHENTICATION_EXPIRED", "auth_expired"],
    [409, "CONSENT_SUPERSEDED", "auth_superseded"],
    [403, "PARTICIPATION_WITHDRAWN", "auth_superseded"],
    [401, "AUTHENTICATION_INVALID", "auth_invalid"],
    [503, "INTERNAL_ERROR", "auth_unavailable"],
  ])(
    "distinguishes verification status %s %s",
    async (status, code, reason) => {
      getClientIdMock.mockResolvedValue("client_123")
      getPseudonymMock.mockResolvedValue("psn_123")
      fetchWithRetryMock.mockResolvedValueOnce(
        Response.json({ error: "synthetic", code }, { status }),
      )
      const { verifyAuthentication } = await import("./auth-service")
      expect(
        await verifyAuthentication({ consentId: snapshot.consentId } as never),
      ).toEqual({ ok: false, reason })
      expect(loggerMock.error).not.toHaveBeenCalled()
    },
  )
  it("preserves preparation when the API rate limits a resend", async () => {
    unsealMock.mockResolvedValue(snapshot)
    writeEmailToSessionMock.mockResolvedValue("psn_123")
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json(
        { error: "limited", code: "RATE_LIMITED" },
        { status: 429 },
      ),
    )
    const pending = { ...session, preparedConsentContext: "persisted" }
    const { sendMagicLinkEmail } = await import("./auth-service")
    expect(
      await sendMagicLinkEmail(
        pending as never,
        "user@example.com",
        "persisted",
      ),
    ).toEqual({ ok: false, reason: "send_rate_limited" })
    expect(pending.preparedConsentContext).toBe("persisted")
    expect(pending.save).toHaveBeenCalledTimes(2)
  })
  it("expires preparation explicitly without silently renewing the send", async () => {
    const pending = {
      stage: "unauthenticated",
      coordinationId: "session-1",
      consentId: "SendConsentRequest01",
      clientId: "client_123",
      pseudonym: "psn_123",
      preparedConsentContext: "persisted",
      save: vi.fn(),
    }
    unsealMock.mockResolvedValue(snapshot)
    writeEmailToSessionMock.mockResolvedValue("psn_123")
    fetchWithRetryMock.mockResolvedValueOnce(
      Response.json(
        { error: "expired", code: "AUTHENTICATION_EXPIRED" },
        { status: 401 },
      ),
    )
    const { sendMagicLinkEmail } = await import("./auth-service")
    expect(
      await sendMagicLinkEmail(
        pending as never,
        "user@example.com",
        "persisted",
      ),
    ).toEqual({ ok: false, reason: "consent_expired" })
    expect(pending).not.toHaveProperty("preparedConsentContext")
    expect(pending.save).toHaveBeenCalledTimes(3)
    expect(fetchWithRetryMock).toHaveBeenCalledOnce()
  })
})

it("rejects an old displayed document set before preparing or sending mail", async () => {
  vi.clearAllMocks()
  const { prepareConsentForEmail } = await import("./auth-service")
  const result = await prepareConsentForEmail(
    { coordinationId: "session-1", save: vi.fn() } as never,
    "user@example.com",
    "b".repeat(64),
  )
  expect(result).toEqual({ ok: false, reason: "document_set_changed" })
  expect(fetchWithRetryMock).not.toHaveBeenCalled()
  expect(sealMock).not.toHaveBeenCalled()
})
