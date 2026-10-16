import { beforeEach, expect, it, vi } from "vitest"
import { createEmailConfirmationFixture } from "../test-support/email-confirmation.js"
import { Timestamp } from "../test-support/firestore.js"

vi.mock("@google-cloud/firestore", async () => {
  const { Timestamp } = await import("../test-support/firestore.js")
  return { Timestamp, FieldValue: { serverTimestamp: () => Timestamp.now() } }
})

import { consumeEmailConfirmation } from "./email-authentication.js"
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

it.each([
  {},
  { questionnaireKind: "unknown" },
  { questionnaireKind: "initial" },
  { questionnaireKind: "follow-up" },
  { destination: null, questionnaireKind: "initial" },
  { destination: "initial-survey" },
])("rejects malformed recovery before sending mail: %j", async (fields) => {
  const stateRef = run(() => getParticipationStateRef(request.pseudonym))
  db.seed(stateRef.path, {
    pseudonym: request.pseudonym,
    status: "active",
    recoveryAuthorization: {
      recoveryId: "11111111-1111-4111-8111-111111111111",
      expectedStudyGeneration: null,
      precedingWithdrawalId: null,
      ...fields,
    },
  })
  await expect(send()).rejects.toMatchObject({ code: "RECOVERY_INVALID" })
  expect(mail.messages).toHaveLength(0)
  expect(db.data(`emailConfirmations/${request.consentId}`)).toBeUndefined()
})

it.each(["active", "withdrawn"])(
  "keeps researcher-recovered confirmation replays used from %s without consuming the grant again",
  async (status) => {
    const stateRef = run(() => getParticipationStateRef(request.pseudonym))
    const recoveryId = "11111111-1111-4111-8111-111111111111"
    const authorization = {
      recoveryId,
      destination: "initial-document",
      expectedStudyGeneration: null,
      precedingWithdrawalId: status === "withdrawn" ? "withdrawal-1" : null,
      actorId: "synthetic-researcher",
      reason: "Synthetic reviewed recovery",
      authorizedAt: Timestamp.now(),
    }
    db.seed(stateRef.path, {
      pseudonym: request.pseudonym,
      status,
      ...(status === "withdrawn"
        ? {
            lastWithdrawalId: "withdrawal-1",
            cleanupStatus: "complete",
            hasCompletedAnalysis: false,
          }
        : {}),
      recoveryAuthorization: authorization,
    })
    const recoveryPath = `participationEvents/${recoveryId}`
    db.seed(recoveryPath, {
      ...authorization,
      pseudonym: request.pseudonym,
      eventType: "recovery_authorized",
    })
    await send({
      ...request,
      expectedWithdrawalId: status === "withdrawn" ? "withdrawal-1" : null,
      expectedRecoveryId: recoveryId,
    })
    expect(
      db.data(
        `participationEvents/authentication-request-${request.consentId}`,
      ),
    ).toMatchObject({
      recoveryId,
      studyGeneration: null,
    })
    await run(() => consumeEmailConfirmation(confirmation(), runtime))
    const paths = [
      stateRef.path,
      recoveryPath,
      `emailConfirmations/${request.consentId}`,
      `participationEvents/${request.consentId}`,
    ]
    const accepted = paths.map((path) => db.data(path))
    expect(accepted[0]).toMatchObject({
      studyGeneration: recoveryId,
      recoveryAuthorization: { usedConsentId: request.consentId },
    })
    await expect(
      run(() => consumeEmailConfirmation(confirmation(), runtime)),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_USED" })
    expect(paths.map((path) => db.data(path))).toEqual(accepted)
  },
)

async function participantCall(
  handler: typeof import("./participant-handlers.js").verifyAuthentication,
  body: unknown,
) {
  let status = 200
  let value: Record<string, unknown> = {}
  const response = {
    status(code: number) {
      status = code
      return this
    },
    json(data: Record<string, unknown>) {
      value = data
      return this
    },
  }
  await run(() =>
    handler(
      { body } as import("express").Request,
      response as unknown as import("express").Response,
    ),
  )
  return { status, ...value }
}

async function prepareRecovery(
  destination: "initial-document" | "initial-survey" | "follow-up-document",
  presented = true,
) {
  const api = await import("./participant-handlers.js")
  db.seed(run(() => getParticipationStateRef(request.pseudonym)).path, {
    pseudonym: request.pseudonym,
    status: "active",
    consentBoundaryId: null,
  })
  const owner = {
    serverId: request.serverId,
    pseudonym: request.pseudonym,
    clientId: "original-client",
    consentId: "OriginalConsent00000A",
  }
  db.seed(`participationEvents/${owner.consentId}`, {
    ...owner,
    eventType: "consent",
    authenticationVersion: 2,
    studyGeneration: null,
    precedingWithdrawalId: null,
  })
  db.seed(`emailConfirmations/${owner.consentId}`, {
    ...owner,
    status: "completed",
    authenticationVersion: 2,
    precedingWithdrawalId: null,
  })
  const analysisId = "original-analysis"
  expect(
    (
      await participantCall(api.recordAnalysisAttempt, {
        ...owner,
        analysisId,
        outcome: "started",
        startedAtMs: now,
        documentGraphemeCounts: [100],
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await participantCall(api.recordAnalysisAttempt, {
        ...owner,
        analysisId,
        outcome: "completed",
        endedAtMs: now + 1000,
        durationMs: 1000,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await participantCall(api.recordAnalysisCompletion, {
        ...owner,
        analysisId,
        analysisWorkspaceVersion: "1.0.0",
        documentCount: 1,
      })
    ).status,
  ).toBe(200)
  if (presented)
    expect(
      (
        await participantCall(api.recordAnalysisAttempt, {
          ...owner,
          analysisId,
          outcome: "presented",
        })
      ).status,
    ).toBe(200)
  const recoveryId = "22222222-2222-4222-8222-222222222222"
  const statePath = run(() => getParticipationStateRef(request.pseudonym)).path
  const state = db.data(statePath)
  const grant = {
    recoveryId,
    destination,
    expectedStudyGeneration: null,
    precedingWithdrawalId: null,
    ...(destination === "initial-survey"
      ? { analysisId, sourceOwner: owner }
      : {}),
    questionnaireKind:
      destination === "follow-up-document" ? "follow-up" : "initial",
    actorId: "reviewer",
    reason: "Synthetic incident review",
  }
  db.seed(statePath, { ...state, recoveryAuthorization: grant })
  db.seed(`participationEvents/${recoveryId}`, {
    ...grant,
    eventType: "recovery_authorized",
    pseudonym: request.pseudonym,
  })
  request.expectedRecoveryId = recoveryId
  return { api, owner, analysisId, recoveryId, statePath }
}

it.each(["initial-document", "initial-survey", "follow-up-document"] as const)(
  "consumes %s only after new email authentication and fences the old owner",
  async (destination) => {
    const { api, owner, analysisId, recoveryId, statePath } =
      await prepareRecovery(destination)
    expect(
      await participantCall(api.verifyAuthentication, owner),
    ).toMatchObject({ status: 409, code: "CONSENT_SUPERSEDED" })
    expect(
      await participantCall(api.listParticipationEvents, {
        pseudonym: request.pseudonym,
      }),
    ).toMatchObject({ pendingRecovery: { recoveryId, destination } })
    await send()
    expect(
      await participantCall(api.verifyAuthentication, {
        serverId: request.serverId,
        pseudonym: request.pseudonym,
        clientId: request.clientId,
        consentId: request.consentId,
      }),
    ).toMatchObject({ status: 409, code: "AUTHENTICATION_PENDING" })
    await run(() => consumeEmailConfirmation(confirmation(), runtime))
    const verified = await participantCall(api.verifyAuthentication, {
      serverId: request.serverId,
      pseudonym: request.pseudonym,
      clientId: request.clientId,
      consentId: request.consentId,
    })
    expect(verified).toMatchObject({
      status: 200,
      questionnaireKind:
        destination === "follow-up-document" ? "follow-up" : "initial",
    })
    if (destination === "initial-survey")
      expect(verified).toMatchObject({
        recovery: { recoveryId, destination, analysisId },
      })
    expect(db.data(statePath)?.recoveryAuthorization.usedConsentId).toBe(
      request.consentId,
    )
    expect(
      await participantCall(api.verifyAuthentication, owner),
    ).toMatchObject({ status: 409, code: "CONSENT_SUPERSEDED" })
    expect(
      await participantCall(api.recordAnalysisAttempt, {
        ...owner,
        analysisId,
        outcome: "presented",
      }),
    ).toMatchObject({ status: 409, code: "CONSENT_SUPERSEDED" })
  },
)

it.each([true, false])(
  "submits the original initial questionnaire without a result body, preserving provenance and reviewed presentation (%s)",
  async (presented) => {
    const { api, owner, analysisId, recoveryId, statePath } =
      await prepareRecovery("initial-survey", presented)
    const original = db.data(`analysisQuestionnaires/${analysisId}`)
    await send()
    await run(() => consumeEmailConfirmation(confirmation(), runtime))
    const survey = {
      serverId: request.serverId,
      clientId: request.clientId,
      pseudonym: request.pseudonym,
      consentId: request.consentId,
      analysisId,
      questionnaire: {
        kind: "initial",
        definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
      },
      answers: { q1: "answer" },
    }
    expect((await participantCall(api.submitSurvey, survey)).status).toBe(200)
    const accepted = db.data(`analysisQuestionnaires/${analysisId}`)
    expect(accepted).toMatchObject(owner)
    expect(accepted?.presentationRecordedAt).toEqual(
      original?.presentationRecordedAt,
    )
    expect(accepted?.recoverySubmission).toMatchObject({
      recoveryId,
      consentId: request.consentId,
    })
    expect(db.data(statePath)?.studyStatus).toBe("follow-up")
    expect((await participantCall(api.submitSurvey, survey)).status).toBe(200)
    expect(db.data(`analysisQuestionnaires/${analysisId}`)).toEqual(accepted)
    expect(
      await participantCall(api.submitSurvey, {
        ...survey,
        answers: { q1: "changed" },
      }),
    ).toMatchObject({ status: 409, code: "SURVEY_ANSWER_CONFLICT" })
    expect(
      await participantCall(api.submitSurvey, {
        ...survey,
        clientId: "unrelated-client",
      }),
    ).toMatchObject({ status: 409, code: "OWNER_CONFLICT" })
    expect(
      await participantCall(api.submitSurvey, {
        ...survey,
        analysisId: "different-analysis",
      }),
    ).toMatchObject({ status: 404 })
    expect(
      (
        await participantCall(api.withdrawParticipation, {
          serverId: survey.serverId,
          clientId: survey.clientId,
          pseudonym: survey.pseudonym,
          consentId: survey.consentId,
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
          encryptedEmail: request.encryptedEmail,
        })
      ).status,
    ).toBe(200)
    expect(db.data(`analysisQuestionnaires/${analysisId}`)).toBeUndefined()
    const retired = db.data(
      `participationEvents/authentication-${request.consentId}`,
    )
    expect(retired).toMatchObject({
      eventType: "authentication_retired",
      recoveryId,
    })
    expect(retired).not.toHaveProperty("tokenHash")
    expect(db.data(`analysisRuns/${analysisId}`)).toMatchObject({
      ...owner,
      recoverySubmission: {
        recoveryId,
        consentId: request.consentId,
        clientId: request.clientId,
        serverId: request.serverId,
        studyGeneration: recoveryId,
      },
    })
  },
)

it.each(["submitted", "deleted", "different-owner"])(
  "refuses an unavailable recovery target at consumption (%s)",
  async (incident) => {
    const { analysisId } = await prepareRecovery("initial-survey")
    await send()
    const path = `analysisQuestionnaires/${analysisId}`
    if (incident === "deleted") db.records.delete(path)
    else
      db.seed(path, {
        ...db.data(path),
        ...(incident === "submitted"
          ? { submittedAt: Timestamp.now() }
          : { clientId: "changed" }),
      })
    await expect(
      run(() => consumeEmailConfirmation(confirmation(), runtime)),
    ).rejects.toMatchObject({
      code:
        incident === "different-owner"
          ? "OWNER_CONFLICT"
          : "RECOVERY_TARGET_UNAVAILABLE",
    })
    expect(db.data(`participationEvents/${request.consentId}`)).toBeUndefined()
  },
)

it("rejects a link issued before a replacement grant and a grant from an earlier withdrawal boundary", async () => {
  const { statePath } = await prepareRecovery("initial-document")
  await send()
  const state = db.data(statePath)
  db.seed(statePath, {
    ...state,
    recoveryAuthorization: {
      ...state?.recoveryAuthorization,
      recoveryId: "33333333-3333-4333-8333-333333333333",
    },
  })
  await expect(
    run(() => consumeEmailConfirmation(confirmation(), runtime)),
  ).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
  db.seed(statePath, { ...state, lastWithdrawalId: "new-withdrawal" })
  advanceMailCooldown()
  await expect(
    send({
      ...request,
      consentId: "ZbCdEfGhIjKlMnOpQrSt",
      expectedWithdrawalId: "new-withdrawal",
    }),
  ).rejects.toMatchObject({ code: "CONSENT_SUPERSEDED" })
})

it.each(["missing", "different", "superseded"])(
  "rejects a %s durable grant despite a valid state pointer",
  async (variant) => {
    const recoveryId = "11111111-1111-4111-8111-111111111111"
    const authorization = {
      recoveryId,
      destination: "initial-document",
      expectedStudyGeneration: null,
      precedingWithdrawalId: null,
      actorId: "synthetic-researcher",
      reason: "Synthetic review",
      authorizedAt: Timestamp.now(),
    }
    db.seed(run(() => getParticipationStateRef(request.pseudonym)).path, {
      pseudonym: request.pseudonym,
      status: "active",
      recoveryAuthorization: authorization,
    })
    if (variant !== "missing")
      db.seed(`participationEvents/${recoveryId}`, {
        ...authorization,
        pseudonym: request.pseudonym,
        eventType: "recovery_authorized",
        ...(variant === "different"
          ? { destination: "follow-up-document" }
          : { supersededBy: "new-grant" }),
      })
    await expect(send()).rejects.toMatchObject({ code: "RECOVERY_INVALID" })
    expect(mail.messages).toHaveLength(0)
    expect(db.data(`emailConfirmations/${request.consentId}`)).toBeUndefined()
  },
)

it.each(["research", "test", undefined])(
  "inherits recovery access purpose %s from the stored confirmation without reclassification",
  async (purpose) => {
    const { recoveryId } = await prepareRecovery("initial-document")
    await send()
    const path = `emailConfirmations/${request.consentId}`
    const pending = { ...db.data(path) }
    if (purpose === undefined) delete pending.dataPurpose
    else pending.dataPurpose = purpose
    db.seed(path, pending)
    runtime.testEmailAddresses = purpose === "test" ? [] : [request.email]
    await run(() => consumeEmailConfirmation(confirmation(), runtime))
    const access = [...db.records].filter(
      ([key, value]) =>
        key.startsWith("accessEvents/") &&
        value.eventType === "recovery_consumed",
    )
    expect(access).toHaveLength(1)
    expect(access[0][1]).toMatchObject({
      recoveryId,
      dataPurpose: purpose ?? "unclassified",
    })
    await expect(
      run(() => consumeEmailConfirmation(confirmation(), runtime)),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_USED" })
    expect(
      [...db.records].filter(
        ([key, value]) =>
          key.startsWith("accessEvents/") &&
          value.eventType === "recovery_consumed",
      ),
    ).toEqual(access)
  },
)
