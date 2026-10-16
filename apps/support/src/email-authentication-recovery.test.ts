import { afterEach, expect, it, vi } from "vitest"
import { createEmailConfirmationFixture } from "../test-support/email-confirmation.js"

vi.mock("@google-cloud/firestore", async () => {
  const { Timestamp } = await import("../test-support/firestore.js")
  return { Timestamp, FieldValue: { serverTimestamp: () => Timestamp.now() } }
})

import { consumeEmailConfirmation } from "./email-authentication.js"
import { verifyAuthentication } from "./participant-handlers.js"
import { getParticipationStateRef } from "./participant-state.js"

afterEach(() => vi.restoreAllMocks())

function recoveryFixture() {
  const fixture = createEmailConfirmationFixture()
  const { db, request, run, now } = fixture
  vi.spyOn(Date, "now").mockReturnValue(now)
  const recoveryId = "11111111-1111-4111-8111-111111111111"
  const grant = {
    recoveryId,
    destination: "initial-document",
    expectedStudyGeneration: null,
    precedingWithdrawalId: null,
    actorId: "synthetic-reviewer",
    reason: "Synthetic reviewed recovery",
  }
  db.seed(run(() => getParticipationStateRef(request.pseudonym)).path, {
    pseudonym: request.pseudonym,
    status: "active",
    recoveryAuthorization: grant,
  })
  db.seed(`participationEvents/${recoveryId}`, {
    ...grant,
    pseudonym: request.pseudonym,
    eventType: "recovery_authorized",
  })
  request.expectedRecoveryId = recoveryId
  return fixture
}

it.each([0, 2 * 3600_000])(
  "acknowledges the exact consumed recovery request after %i ms without mail or record changes",
  async (elapsed) => {
    const { db, send, run, confirmation, runtime, mail, now } =
      recoveryFixture()
    await send()
    await run(() => consumeEmailConfirmation(confirmation(), runtime))
    const accepted = JSON.stringify([...db.records])
    vi.spyOn(Date, "now").mockReturnValue(now + elapsed)
    expect((await send()).ok).toBe(true)
    expect(mail.messages).toHaveLength(1)
    expect(JSON.stringify([...db.records]) === accepted).toBe(true)
  },
)

it("rejects the original pending request when another consent consumes the same grant", async () => {
  const { db, send, request, run, confirmation, runtime, mail, now } =
    recoveryFixture()
  await send()
  vi.spyOn(Date, "now").mockReturnValue(now + 60_000)
  await send({
    ...request,
    clientId: "other-client",
    consentId: "OtherConsent00000001",
  })
  await run(() => consumeEmailConfirmation(confirmation(1), runtime))
  const accepted = JSON.stringify([...db.records])
  await expect(send()).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
  expect(mail.messages).toHaveLength(2)
  expect(JSON.stringify([...db.records]) === accepted).toBe(true)
})

it.each(["grant", "generation"])(
  "rejects a first dispatch prepared before a changed %s",
  async (change) => {
    const { now, request, run, db, send, mail } =
      createEmailConfirmationFixture()
    vi.spyOn(Date, "now").mockReturnValue(now)
    const recoveryId = "33333333-3333-4333-8333-333333333333"
    const grant = {
      recoveryId,
      destination: "initial-document",
      expectedStudyGeneration: null,
      precedingWithdrawalId: null,
    }
    const statePath = run(() =>
      getParticipationStateRef(request.pseudonym),
    ).path
    db.seed(statePath, {
      pseudonym: request.pseudonym,
      status: "active",
      ...(change === "grant"
        ? { recoveryAuthorization: grant }
        : { studyGeneration: recoveryId }),
    })
    db.seed(`participationEvents/${recoveryId}`, {
      ...grant,
      pseudonym: request.pseudonym,
      eventType: "recovery_authorized",
    })
    await expect(send()).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
    expect(mail.messages).toHaveLength(0)
    expect(db.data(`emailConfirmations/${request.consentId}`)).toBeUndefined()
  },
)

it.each(["new-grant", "replacement-grant", "consumed-grant"])(
  "rejects stale resend and verification after %s without sending mail",
  async (mode) => {
    const fixture = createEmailConfirmationFixture()
    const { db, run, now, request, send, mail, confirmation, runtime } = fixture
    vi.spyOn(Date, "now").mockReturnValue(now)
    const statePath = run(() =>
      getParticipationStateRef(request.pseudonym),
    ).path
    const installGrant = (recoveryId: string) => {
      const grant = {
        recoveryId,
        destination: "initial-document",
        expectedStudyGeneration: null,
        precedingWithdrawalId: null,
        actorId: "synthetic-reviewer",
        reason: "Synthetic reviewed recovery",
      }
      db.seed(statePath, {
        ...db.data(statePath),
        pseudonym: request.pseudonym,
        status: "active",
        recoveryAuthorization: grant,
      })
      db.seed(`participationEvents/${recoveryId}`, {
        ...grant,
        pseudonym: request.pseudonym,
        eventType: "recovery_authorized",
      })
    }
    if (mode === "replacement-grant") {
      installGrant("11111111-1111-4111-8111-111111111111")
      request.expectedRecoveryId = "11111111-1111-4111-8111-111111111111"
    }
    await send()
    const original = db.data(`emailConfirmations/${request.consentId}`)
    installGrant("22222222-2222-4222-8222-222222222222")
    if (mode === "replacement-grant")
      db.seed("participationEvents/11111111-1111-4111-8111-111111111111", {
        ...db.data("participationEvents/11111111-1111-4111-8111-111111111111"),
        supersededBy: "22222222-2222-4222-8222-222222222222",
      })
    if (mode === "consumed-grant") {
      vi.spyOn(Date, "now").mockReturnValue(now + 60_000)
      await send({
        ...request,
        consentId: "RecoveryConsent00001",
        expectedRecoveryId: "22222222-2222-4222-8222-222222222222",
      })
      await run(() => consumeEmailConfirmation(confirmation(1), runtime))
      expect(db.data(statePath)?.studyGeneration).toBe(
        "22222222-2222-4222-8222-222222222222",
      )
    }
    vi.spyOn(Date, "now").mockReturnValue(now + 120_000)
    const mailCount = mail.messages.length
    await expect(send()).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
    expect(mail.messages).toHaveLength(mailCount)
    expect(db.data(`emailConfirmations/${request.consentId}`)).toEqual(original)
    await expect(
      run(() => consumeEmailConfirmation(confirmation(0), runtime)),
    ).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
    let status = 200
    let responseBody: unknown
    const response = {
      status(value: number) {
        status = value
        return this
      },
      json(value: unknown) {
        responseBody = value
        return this
      },
    }
    await run(() =>
      verifyAuthentication(
        {
          body: {
            pseudonym: request.pseudonym,
            consentId: request.consentId,
            clientId: request.clientId,
            serverId: request.serverId,
          },
        } as import("express").Request,
        response as unknown as import("express").Response,
      ),
    )
    expect(status).toBe(409)
    expect(responseBody).toMatchObject({ code: "CONSENT_SUPERSEDED" })
  },
)
