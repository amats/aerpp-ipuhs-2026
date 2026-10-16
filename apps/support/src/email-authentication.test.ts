import { beforeEach, expect, it, vi } from "vitest"
import { createEmailConfirmationFixture } from "../test-support/email-confirmation.js"

vi.mock("@google-cloud/firestore", async () => {
  const { Timestamp } = await import("../test-support/firestore.js")
  return { Timestamp, FieldValue: { serverTimestamp: () => Timestamp.now() } }
})

import {
  consumeEmailConfirmation,
  issueEmailConfirmation,
} from "./email-authentication.js"
import { getParticipationStateRef } from "./participant-state.js"

let { db, mail, runtime, now, request, run, send, confirmation } =
  createEmailConfirmationFixture()
const advanceMailCooldown = () =>
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000)
beforeEach(() => {
  ;({ db, mail, runtime, now, request, run, send, confirmation } =
    createEmailConfirmationFixture())
  vi.spyOn(Date, "now").mockReturnValue(now)
})

it.each([false, true, null, undefined])(
  "requires an administrator grant after withdrawal regardless of completion evidence: %s",
  async (hasCompletedAnalysis) => {
    const stateRef = run(() => getParticipationStateRef(request.pseudonym))
    const withdrawalId = "accepted-withdrawal"
    const state = {
      pseudonym: request.pseudonym,
      status: "withdrawn",
      cleanupStatus: "complete",
      lastWithdrawalId: withdrawalId,
      hasCompletedAnalysis,
    }
    db.seed(stateRef.path, state)
    await expect(
      send({ ...request, expectedWithdrawalId: withdrawalId }),
    ).rejects.toMatchObject({ code: "RESEARCHER_AUTHORIZATION_REQUIRED" })
    expect(mail.messages).toHaveLength(0)
    expect(db.data(`emailConfirmations/${request.consentId}`)).toBeUndefined()
    expect(db.data(stateRef.path)).toEqual(state)
  },
)

it.each([false, true, null, undefined])(
  "rejects a pending link without a grant when withdrawn completion evidence is %s",
  async (hasCompletedAnalysis) => {
    const stateRef = run(() => getParticipationStateRef(request.pseudonym))
    const withdrawalId = "accepted-withdrawal"
    db.seed(stateRef.path, {
      pseudonym: request.pseudonym,
      status: "active",
      lastWithdrawalId: withdrawalId,
    })
    await send({ ...request, expectedWithdrawalId: withdrawalId })
    const pending = db.data(`emailConfirmations/${request.consentId}`)
    const withdrawnState = {
      ...db.data(stateRef.path),
      status: "withdrawn",
      cleanupStatus: "complete",
      hasCompletedAnalysis,
    }
    db.seed(stateRef.path, withdrawnState)
    await expect(
      run(() => consumeEmailConfirmation(confirmation(), runtime)),
    ).rejects.toMatchObject({ code: "RESEARCHER_AUTHORIZATION_REQUIRED" })
    expect(db.data(stateRef.path)).toEqual(withdrawnState)
    expect(db.data(`emailConfirmations/${request.consentId}`)).toEqual(pending)
    expect(db.data(`participationEvents/${request.consentId}`)).toBeUndefined()
  },
)

it("stores only a token verifier, sends a fragment link and consumes it once without extending replay lifetime", async () => {
  await send()
  const link = new URL(mail.messages[0].confirmationUrl)
  expect(link.search).toBe("")
  const input = confirmation()
  const pending = db.data(`emailConfirmations/${request.consentId}`)
  expect(JSON.stringify(pending)).not.toContain(input.token)
  expect(JSON.stringify(pending)).not.toContain(request.email)
  expect(pending?.status).toBe("sent")
  expect(db.data(`participationEvents/${request.consentId}`)).toBeUndefined()
  await run(() => consumeEmailConfirmation(input, runtime))
  const completed = db.data(`emailConfirmations/${request.consentId}`)
  const consent = db.data(`participationEvents/${request.consentId}`)
  expect(completed).not.toHaveProperty("expireAt")
  expect(completed).not.toHaveProperty("encryptedEmail")
  expect(completed).not.toHaveProperty("tokenNonce")
  expect(consent?.encryptedEmail).toBe(request.encryptedEmail)
  await expect(
    run(() => consumeEmailConfirmation(input, runtime)),
  ).rejects.toMatchObject({ code: "AUTHENTICATION_USED" })
  expect(db.data(`emailConfirmations/${request.consentId}`)).toEqual(completed)
  expect(db.data(`participationEvents/${request.consentId}`)).toEqual(consent)
  expect(
    db.data(`participationEvents/${request.consentId}`)?.authenticationVersion,
  ).toBe(2)
})
it("response loss and mail failure can resend the same usable link without changing the fixed deadline", async () => {
  const deliver = vi
    .spyOn(mail, "send")
    .mockRejectedValueOnce(new Error("mail timeout with private detail"))
  await expect(send()).rejects.toThrow()
  const pending = db.data(`emailConfirmations/${request.consentId}`)
  advanceMailCooldown()
  await send()
  advanceMailCooldown()
  await send()
  expect(deliver).toHaveBeenCalledTimes(3)
  expect(mail.messages[0].confirmationUrl).toBe(
    mail.messages[1].confirmationUrl,
  )
  expect(db.data(`emailConfirmations/${request.consentId}`)).toEqual(pending)
  await expect(
    send({ ...request, encryptedEmail: "changed" }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUEST_CONFLICT" })
  await run(() => consumeEmailConfirmation(confirmation(), runtime))
  const consent = db.data(`participationEvents/${request.consentId}`)
  expect(consent?.consentRequestedAt).toEqual(pending?.createdAt)
  expect(consent?.consentRequestedAt.toMillis()).toBe(now)
  expect(consent?.consentConfirmedAt.toMillis()).toBe(now + 120_000)
  expect(consent).not.toHaveProperty("createdAt")
  await send()
  expect(db.data(`participationEvents/${request.consentId}`)).toEqual(consent)
})

it.each([undefined, null, "unknown"])(
  "does not invent a request time when the pending record has createdAt=%s",
  async (createdAt) => {
    await send()
    const path = `emailConfirmations/${request.consentId}`
    const pending = { ...db.data(path) }
    if (createdAt === undefined) delete pending.createdAt
    else pending.createdAt = createdAt
    db.seed(path, pending)
    await run(() => consumeEmailConfirmation(confirmation(), runtime))
    const consent = db.data(`participationEvents/${request.consentId}`)
    expect(consent).not.toHaveProperty("consentRequestedAt")
    expect(consent?.consentConfirmedAt.toMillis()).toBe(now)
  },
)

it("rejects caller-supplied consent timestamps before sending mail", async () => {
  await expect(
    send({ ...request, consentRequestedAt: "2000-01-01T00:00:00Z" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" })
  expect(mail.messages).toHaveLength(0)
  expect(db.data(`emailConfirmations/${request.consentId}`)).toBeUndefined()
})
it("simultaneous issue and completion requests serialize; exactly one completion wins", async () => {
  const issues = await Promise.allSettled([send(), send()])
  expect(issues.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  )
  expect(issues.find((result) => result.status === "rejected")).toMatchObject({
    reason: { status: 429, code: "RATE_LIMITED" },
  })
  expect(mail.messages).toHaveLength(1)
  const results = await Promise.allSettled([
    run(() => consumeEmailConfirmation(confirmation(), runtime)),
    run(() => consumeEmailConfirmation(confirmation(), runtime)),
  ])
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1)
  expect(db.retries).toBeGreaterThan(0)
})
it("rejects wrong tokens, expired links, legacy authentication and consent IDs alone", async () => {
  await send()
  await expect(
    run(() =>
      consumeEmailConfirmation({ consentId: request.consentId }, runtime),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" })
  await expect(
    run(() =>
      consumeEmailConfirmation(
        { ...confirmation(), token: "x".repeat(43) },
        runtime,
      ),
    ),
  ).rejects.toMatchObject({ code: "AUTHENTICATION_INVALID" })
  const ref = `emailConfirmations/${request.consentId}`
  db.seed(ref, { ...db.data(ref), authenticationVersion: 1 })
  await expect(
    run(() => consumeEmailConfirmation(confirmation(), runtime)),
  ).rejects.toMatchObject({ code: "AUTHENTICATION_INVALID" })
  await expect(send()).rejects.toMatchObject({
    code: "CONSENT_REQUEST_CONFLICT",
  })
  db.seed(ref, { ...db.data(ref), authenticationVersion: 2 })
  vi.spyOn(Date, "now").mockReturnValue(now + 3600001)
  await expect(
    run(() => consumeEmailConfirmation(confirmation(), runtime)),
  ).rejects.toMatchObject({ code: "AUTHENTICATION_EXPIRED" })
  db.records.delete(ref)
  await expect(send()).rejects.toMatchObject({ code: "AUTHENTICATION_EXPIRED" })
})
it("withdrawal racing confirmation fences late completion and does not restore participation", async () => {
  await send()
  const ref = run(() => getParticipationStateRef(request.pseudonym))
  let injected = false
  db.beforeCommit = async (writes) => {
    if (
      !injected &&
      writes.some((write) => write.ref.path.startsWith("participationEvents/"))
    ) {
      injected = true
      db.seed(ref.path, {
        pseudonym: request.pseudonym,
        status: "withdrawn",
        lastWithdrawalId: "withdrawal-1",
        cleanupStatus: "pending",
      })
    }
  }
  await expect(
    run(() => consumeEmailConfirmation(confirmation(), runtime)),
  ).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
  expect(db.data(`participationEvents/${request.consentId}`)).toBeUndefined()
  expect(db.data(ref.path)?.status).toBe("withdrawn")
})
it("rate limits survive independent requests and prevent a sixth mail to the same recipient", async () => {
  for (let index = 0; index < 5; index++) {
    advanceMailCooldown()
    await send()
  }
  advanceMailCooldown()
  await expect(send()).rejects.toMatchObject({
    status: 429,
    code: "RATE_LIMITED",
  })
  expect(mail.messages).toHaveLength(5)
})
it("reauthorizing a caller does not change the previous withdrawal boundary or completed consent", async () => {
  await send()
  await run(() => consumeEmailConfirmation(confirmation(), runtime))
  const completed = db.data(`emailConfirmations/${request.consentId}`)
  await send()
  expect(mail.messages).toHaveLength(1)
  expect(db.data(`emailConfirmations/${request.consentId}`)).toEqual(completed)
})

it("resends records with an old key ID and rejects a changed derivation key", async () => {
  await send()
  const path = `emailConfirmations/${request.consentId}`
  expect(db.data(path)).not.toHaveProperty("tokenKeyId")
  db.seed(path, { ...db.data(path), tokenKeyId: "previous-manual-id" })
  const previous = db.data(path)
  advanceMailCooldown()
  await send()
  expect(mail.messages[1].confirmationUrl).toBe(
    mail.messages[0].confirmationUrl,
  )
  await expect(
    run(() =>
      issueEmailConfirmation(
        request,
        "local",
        {
          ...runtime,
          tokenKey: "different-synthetic-key-0000000000000000000000000",
        },
        mail,
      ),
    ),
  ).rejects.toMatchObject({ code: "AUTHENTICATION_INVALID" })
  expect(mail.messages).toHaveLength(2)
  expect(db.data(path)).toEqual(previous)
  await run(() => consumeEmailConfirmation(confirmation(), runtime))
  expect(db.data(path)?.status).toBe("completed")
})

it.each(["research", "test"])(
  "freezes %s purpose before confirmation and preserves it through config changes",
  async (purpose) => {
    runtime.testEmailAddresses =
      purpose === "test" ? [request.email.toLowerCase()] : []
    await send({ ...request, email: request.email.toUpperCase() })
    const path = `emailConfirmations/${request.consentId}`
    expect(db.data(path)?.dataPurpose).toBe(purpose)
    runtime.testEmailAddresses =
      purpose === "test" ? [] : [request.email.toLowerCase()]
    advanceMailCooldown()
    await send({ ...request, email: request.email.toUpperCase() })
    await run(() => consumeEmailConfirmation(confirmation(), runtime))
    expect(
      db.data(`participationEvents/${request.consentId}`)?.dataPurpose,
    ).toBe(purpose)
    expect(
      db.data(run(() => getParticipationStateRef(request.pseudonym)).path)
        ?.dataPurpose,
    ).toBe(purpose)
    expect(db.data(path)).not.toHaveProperty("email")
  },
)

it("keeps invalid stored purpose unclassified instead of guessing from current config", async () => {
  await send()
  const path = `emailConfirmations/${request.consentId}`
  const pending = { ...db.data(path) }
  delete pending.dataPurpose
  db.seed(path, pending)
  advanceMailCooldown()
  await send()
  await run(() => consumeEmailConfirmation(confirmation(), runtime))
  expect(db.data(`participationEvents/${request.consentId}`)?.dataPurpose).toBe(
    "unclassified",
  )
})

it("enforces recipient cooldown across consent IDs, callers and an hourly window boundary", async () => {
  vi.spyOn(Date, "now").mockReturnValue(now - 1000)
  await send()
  vi.spyOn(Date, "now").mockReturnValue(now)
  await expect(
    run(() =>
      issueEmailConfirmation(
        {
          ...request,
          consentId: "B".repeat(20),
          clientId: "other-client",
          email: request.email.toUpperCase(),
        },
        "other-caller",
        {
          ...runtime,
          credentials: [{ ...runtime.credentials[0], id: "other-caller" }],
        },
        mail,
      ),
    ),
  ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" })
  expect(mail.messages).toHaveLength(1)
  expect(db.data(`emailConfirmations/${"B".repeat(20)}`)).toBeUndefined()
  vi.spyOn(Date, "now").mockReturnValue(now + 59_000)
  await send()
  expect(mail.messages).toHaveLength(2)
  expect(mail.messages[1].confirmationUrl).toBe(
    mail.messages[0].confirmationUrl,
  )
})

it("retains an unconfirmed request after TTL deletion and cannot reissue its old identity", async () => {
  await send()
  const requested = db.data(
    `participationEvents/authentication-request-${request.consentId}`,
  )
  expect(requested).toMatchObject({
    eventType: "authentication_requested",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    encryptedEmail: request.encryptedEmail,
    consentId: request.consentId,
  })
  expect(JSON.stringify(requested)).not.toContain(request.email)
  expect(requested).not.toHaveProperty("tokenHash")
  db.records.delete(`emailConfirmations/${request.consentId}`)
  advanceMailCooldown()
  await expect(send()).rejects.toMatchObject({ code: "AUTHENTICATION_EXPIRED" })
  expect(
    db.data(`participationEvents/authentication-request-${request.consentId}`),
  ).toEqual(requested)
  expect(db.data(`participationEvents/${request.consentId}`)).toBeUndefined()
})

it("pins the original document set across resend and confirmation and rejects relabelling", async () => {
  await send()
  advanceMailCooldown()
  await expect(
    send({
      ...request,
      documentSet: { version: "2.0", sha256: "b".repeat(64) },
    }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUEST_CONFLICT" })
  await send()
  await run(() => consumeEmailConfirmation(confirmation(), runtime))
  expect(
    db.data(`participationEvents/${request.consentId}`)?.documentSet,
  ).toEqual(request.documentSet)
  expect(
    db.data(`emailConfirmations/${request.consentId}`)?.documentSet,
  ).toEqual(request.documentSet)
})

it("awaits a slow commit and retains the fixed pending identity without starting late mail", async () => {
  db.beforeCommit = async () => {
    vi.spyOn(Date, "now").mockReturnValue(now + 51_000)
  }
  await expect(send()).rejects.toMatchObject({
    code: "MAIL_TEMPORARILY_UNAVAILABLE",
  })
  const retained = db.data(`emailConfirmations/${request.consentId}`)
  expect(retained?.status).toBe("sent")
  expect(mail.messages).toHaveLength(0)
  vi.spyOn(Date, "now").mockReturnValue(now + 120_000)
  await send()
  expect(mail.messages).toHaveLength(1)
  expect(db.data(`emailConfirmations/${request.consentId}`)).toEqual(retained)
})
