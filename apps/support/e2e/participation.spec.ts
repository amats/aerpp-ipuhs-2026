import { createHash, randomUUID } from "node:crypto"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createParticipantRepository } from "@aerpp/firestore/participant-repository"
import { readParticipantResearchSnapshot } from "@aerpp/firestore/participant-snapshot"
import { ListParticipationEventsResponseSchema } from "@aerpp/participant-api-contracts/participant-api"
import { Firestore } from "@google-cloud/firestore"
import { expect, test } from "@playwright/test"
import { createSupportApp } from "../src/app.js"
import { MailSink } from "../src/mail.js"
import { CALLER_SECRET, syntheticRuntime } from "../test-support/runtime.js"

let server: Server
let database: Firestore
let origin: string
const mail = new MailSink()
test.beforeAll(async () => {
  if (!/^127\.0\.0\.1:[0-9]+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
    throw new Error("Isolated emulator required")
  const runtime = syntheticRuntime()
  runtime.testEmailAddresses = ["synthetic@example.invalid"]
  database = new Firestore({ projectId: "demo-support-e2e" })
  const app = createSupportApp(runtime, database, mail)
  server = await new Promise((accept) => {
    const listener = app.listen(0, "127.0.0.1", () => accept(listener))
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  runtime.baseUrl = origin
})
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((accept) => server.close(() => accept()))
  }
  if (database) await database.terminate()
})
test.beforeEach(async () => {
  // Isolate the synthetic caller quota; retain recipient limits within each flow.
  await database
    .collection("supportRateLimits")
    .doc(createHash("sha256").update("api:local").digest("hex"))
    .delete()
})
async function api(path: string, body: unknown) {
  return fetch(`${origin}/api/participant/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer local.${CALLER_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

test("audit-first terminal receipt survives output loss and ordinary terminal delivery", async () => {
  const id = randomUUID()
  const owner = {
    consentId: `audit-loss-consent-${id}`,
    serverId: "server-1",
    clientId: "audit-loss-client",
    pseudonym: `audit-loss-${id}`,
  }
  const repository = createParticipantRepository(database)
  await repository.participationState(owner.pseudonym).set({
    pseudonym: owner.pseudonym,
    status: "active",
    studyStatus: "initial-ready",
    studyGeneration: null,
    consentBoundaryId: null,
  })
  await repository.participationEvent(owner.consentId).set({
    ...owner,
    eventType: "consent",
    authenticationVersion: 2,
    precedingWithdrawalId: null,
    studyGeneration: null,
  })
  const analysisId = `audit-loss-${id}`
  const startedAtMs = Date.now()
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId,
        outcome: "started",
        startedAtMs,
        documentGraphemeCounts: [12],
      })
    ).status,
  ).toBe(200)
  const terminal = {
    ...owner,
    analysisId,
    outcome: "completed",
    endedAtMs: startedAtMs + 1,
  }
  expect((await api("analysis-outcome", terminal)).status).toBe(200)
  const accepted = (await repository.analysisRun(analysisId).get()).data()
  expect(accepted?.outcomeReceivedAt).toBeDefined()
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId,
        outcome: "unavailable",
        reason: "result_unavailable",
      })
    ).status,
  ).toBe(200)
  const retained = (await repository.analysisRun(analysisId).get()).data()
  expect(retained).toMatchObject(accepted ?? {})
  expect(retained?.resultUnavailableAt).toBeDefined()
  expect((await api("analysis-outcome", terminal)).status).toBe(200)
  expect(
    (await api("analysis-attempt", { ...terminal, durationMs: 1 })).status,
  ).toBe(200)
  expect((await repository.analysisRun(analysisId).get()).data()).toEqual(
    retained,
  )
  expect(
    (await repository.analysisAttempt(analysisId).get()).data()?.durationMs,
  ).toBe(1)
})

for (const outcome of [
  "none",
  "started",
  "failed",
  "cancelled",
  "completed",
] as const) {
  test(`withdrawal retains ${outcome} completion evidence after real Firestore deletion`, async ({
    page,
  }) => {
    const consentId = randomUUID().replaceAll("-", "").slice(0, 20)
    const owner = {
      consentId,
      serverId: "server-1",
      clientId: "completion-client",
      pseudonym: `completion-${outcome}`,
    }
    expect(
      (
        await api("send-magic-link", {
          ...owner,
          email: `${outcome}@example.invalid`,
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
          encryptedEmail: "synthetic-ciphertext",
          expectedWithdrawalId: null,
          expectedRecoveryId: null as string | null,
          expectedStudyGeneration: null,
          expiresAtMs: Date.now() + 3600000,
        })
      ).status,
    ).toBe(200)
    const requestedAt = (
      await database.doc(`emailConfirmations/${consentId}`).get()
    ).data()?.createdAt
    expect(requestedAt).toBeDefined()
    expect(
      (await database.doc(`participationEvents/${consentId}`).get()).exists,
    ).toBe(false)
    expect((await api("verify-authentication", owner)).status).toBe(409)
    const message = mail.messages.at(-1)
    if (!message) throw new Error("Expected synthetic confirmation mail")
    await page.goto(message.confirmationUrl)
    await page.getByRole("button", { name: "メールアドレスを確認する" }).click()
    await expect(page.getByRole("status")).toContainText("メール確認は完了")
    const confirmedConsent = (
      await database.doc(`participationEvents/${consentId}`).get()
    ).data()
    expect(confirmedConsent?.eventType).toBe("consent")
    expect(confirmedConsent?.consentRequestedAt).toEqual(requestedAt)
    expect(
      confirmedConsent?.consentConfirmedAt.toMillis(),
    ).toBeGreaterThanOrEqual(requestedAt.toMillis())
    expect(confirmedConsent).not.toHaveProperty("createdAt")
    let retainedHistory: unknown
    const analysisId = `completion-${outcome}`
    const startedAtMs = Date.now()
    if (outcome !== "none") {
      expect(
        (
          await api("analysis-attempt", {
            ...owner,
            analysisId,
            startedAtMs,
            outcome: "started",
            documentGraphemeCounts: [12],
          })
        ).status,
      ).toBe(200)
      if (outcome !== "started")
        expect(
          (
            await api("analysis-attempt", {
              ...owner,
              analysisId,
              outcome,
              endedAtMs: startedAtMs + 1,
              durationMs: 1,
            })
          ).status,
        ).toBe(200)
    }
    const withdrawal = {
      ...owner,
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      encryptedEmail: "synthetic-ciphertext",
    }
    const expectedCompletion =
      outcome === "started" ? null : outcome === "completed"
    for (let retry = 0; retry < 2; retry++) {
      const response = await api("withdraw-participation", withdrawal)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ok: true,
        deletedCount: 0,
        hasCompletedAnalysis: expectedCompletion,
      })
      const history = await database
        .collection("participationEvents")
        .where("pseudonym", "==", owner.pseudonym)
        .get()
      const records = history.docs
        .map((record) => ({ id: record.id, data: record.data() }))
        .sort((left, right) => left.id.localeCompare(right.id))
      expect(records).toHaveLength(4)
      for (const record of records.filter((record) =>
        ["consent", "withdrawal"].includes(record.data.eventType),
      ))
        expect(record.data).not.toHaveProperty("createdAt")
      expect(
        records.find((record) => record.data.eventType === "withdrawal")?.data
          .withdrawalAcceptedAt,
      ).toBeDefined()
      expect(records.find((record) => record.id === consentId)?.data).toEqual(
        confirmedConsent,
      )
      expect(
        records.find((record) => record.data.eventType === "withdrawal")?.data,
      ).toMatchObject({
        consentId,
        hasCompletedAnalysis: expectedCompletion,
      })
      if (retry === 0) retainedHistory = records
      else expect(records).toEqual(retainedHistory)
    }
    expect(
      (await database.doc(`emailConfirmations/${consentId}`).get()).exists,
    ).toBe(false)
    expect(
      (await database.doc(`analysisAttempts/${analysisId}`).get()).exists,
    ).toBe(false)
    if (outcome !== "none") {
      const run = (
        await database.doc(`analysisRuns/${analysisId}`).get()
      ).data()
      expect(run).toMatchObject({ ...owner, outcome, startedAtMs })
      expect(run?.attemptDeletedAt).toBeDefined()
      expect(run).not.toHaveProperty("durationMs")
      expect(run).not.toHaveProperty("documentGraphemeCounts")
    }
    if (outcome === "started") {
      const terminal = {
        ...owner,
        analysisId,
        outcome: "completed",
        endedAtMs: startedAtMs + 1,
        durationMs: 1,
      }
      const { durationMs: _duration, ...auditOnly } = terminal
      expect((await api("analysis-outcome", auditOnly)).status).toBe(200)
      const auditReceipt = (
        await database.doc(`analysisRuns/${analysisId}`).get()
      ).data()
      expect((await api("analysis-outcome", auditOnly)).status).toBe(200)
      expect(
        (await database.doc(`analysisRuns/${analysisId}`).get()).data(),
      ).toEqual(auditReceipt)
      expect((await api("analysis-attempt", terminal)).status).toBe(200)
      const received = (
        await database.doc(`analysisRuns/${analysisId}`).get()
      ).data()
      expect(received?.outcome).toBe("completed")
      expect(received).toEqual(auditReceipt)
      expect((await api("analysis-attempt", terminal)).status).toBe(200)
      expect(
        (await database.doc(`analysisRuns/${analysisId}`).get()).data(),
      ).toEqual(received)
      expect(
        (await api("analysis-attempt", { ...terminal, outcome: "cancelled" }))
          .status,
      ).toBe(409)
      expect(
        (await database.doc(`analysisAttempts/${analysisId}`).get()).exists,
      ).toBe(false)
    }
    {
      const state = await (
        await api("participation-events", { pseudonym: owner.pseudonym })
      ).json()
      const renewed = await api("send-magic-link", {
        ...owner,
        consentId: "UnknownConsentRetry1",
        email: `${outcome}@example.invalid`,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: "synthetic-ciphertext",
        expectedWithdrawalId: state.lastWithdrawalId,
        expectedRecoveryId: null as string | null,
        expectedStudyGeneration: null,
        expiresAtMs: Date.now() + 3600000,
      })
      expect(renewed.status).toBe(409)
      expect(await renewed.json()).toMatchObject({
        code: "RESEARCHER_AUTHORIZATION_REQUIRED",
      })
    }
  })
}

test("browser confirmation, exact analysisQuestionnaires, withdrawal and renewed consent against standalone Firestore", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  )
  const request = {
    consentId: "AbCdEfGhIjKlMnOpQrSt",
    expiresAtMs: Date.now() + 3600000,
    expectedWithdrawalId: null,
    expectedRecoveryId: null as string | null,
    expectedStudyGeneration: null,
    serverId: "server-1",
    clientId: "client-1",
    pseudonym: "emulator-participant",
    email: "synthetic@example.invalid",
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    encryptedEmail: "synthetic-ciphertext",
  }
  expect((await api("send-magic-link", request)).status).toBe(200)
  expect((await api("send-magic-link", request)).status).toBe(429)
  expect(
    (
      await api("withdraw-participation", {
        serverId: request.serverId,
        clientId: request.clientId,
        pseudonym: request.pseudonym,
        consentId: request.consentId,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: request.encryptedEmail,
      })
    ).status,
  ).toBe(401)
  const firstMail = mail.messages.at(-1)
  if (!firstMail) throw new Error("Expected synthetic confirmation mail")
  const firstLink = firstMail.confirmationUrl
  await page.goto(firstLink)
  await expect(page).toHaveURL(`${origin}/email/confirm`)
  const firstAuthentication = (
    await database.doc(`emailConfirmations/${request.consentId}`).get()
  ).data()
  expect(firstAuthentication?.status).toBe("sent")
  const firstRequestedAt = firstAuthentication?.createdAt
  await page.getByRole("button", { name: "メールアドレスを確認する" }).click()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")
  const owner = {
    serverId: request.serverId,
    clientId: request.clientId,
    pseudonym: request.pseudonym,
    consentId: request.consentId,
  }
  expect((await api("verify-authentication", owner)).status).toBe(200)
  const metadata = {
    ...owner,
    analysisWorkspaceVersion: "1.0.0",
    analysisId: "analysis-e2e",
    condition: "synthetic",
  }
  const answers = {
    ...owner,
    analysisId: metadata.analysisId,
    questionnaire: {
      kind: "initial",
      definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
    },
    answers: { q1: "回答" },
  }
  const startedAtMs = Date.now()
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId: metadata.analysisId,
        outcome: "started",
        startedAtMs,
        documentGraphemeCounts: [12],
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId: metadata.analysisId,
        outcome: "completed",
        endedAtMs: startedAtMs + 1,
        durationMs: 1,
      })
    ).status,
  ).toBe(200)
  expect((await api("analysis-completion", metadata)).status).toBe(200)
  expect((await api("survey", answers)).status).toBe(409)
  const presented = {
    ...owner,
    analysisId: metadata.analysisId,
    outcome: "presented",
  }
  expect((await api("analysis-attempt", presented)).status).toBe(200)
  const presentedAt = (
    await database.doc(`analysisAttempts/${metadata.analysisId}`).get()
  ).data()?.presentationRecordedAt
  expect((await api("analysis-attempt", presented)).status).toBe(200)
  expect(
    (await database.doc(`analysisAttempts/${metadata.analysisId}`).get()).data()
      ?.presentationRecordedAt,
  ).toEqual(presentedAt)
  const outcomes = await Promise.all([
    api("survey", answers),
    api("survey", answers),
  ])
  expect(outcomes.map((result) => result.status)).toEqual([200, 200])
  const first = (
    await database.doc("analysisQuestionnaires/analysis-e2e").get()
  ).data()
  expect(first).toMatchObject({
    analysisWorkspaceVersion: "1.0.0",
    _integrity: { metadata: { analysisWorkspaceVersion: "1.0.0" } },
  })
  const relabelled = await api("analysis-completion", {
    ...metadata,
    analysisWorkspaceVersion: "1.0.1",
  })
  expect(relabelled.status).toBe(409)
  expect(await relabelled.json()).toMatchObject({
    code: "ANALYSIS_COMPLETION_CONFLICT",
  })
  expect((await api("analysis-completion", metadata)).status).toBe(200)
  expect(
    (
      await api("survey", {
        ...answers,
        questionnaire: {
          ...answers.questionnaire,
          definitionId: `jcs-v1:sha256:${"b".repeat(64)}`,
        },
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await api("survey", {
        ...owner,
        analysisId: metadata.analysisId,
        questionnaire: answers.questionnaire,
        answers: answers.answers,
      })
    ).status,
  ).toBe(200)
  expect(
    (await database.doc("analysisQuestionnaires/analysis-e2e").get()).data(),
  ).toEqual(first)
  const beforeWithdrawal = await readParticipantResearchSnapshot(database)
  expect(first?.dataPurpose).toBe("test")
  expect(
    beforeWithdrawal.participationEvents.find(
      (record) => record.id === owner.consentId,
    )?.data.dataPurpose,
  ).toBe("test")
  expect(
    beforeWithdrawal.participationStates.find(
      (record) => record.data.pseudonym === request.pseudonym,
    )?.data.dataPurpose,
  ).toBe("test")
  expect(
    beforeWithdrawal.analysisQuestionnaires.find(
      (record) => record.id === "analysis-e2e",
    )?.data.answers,
  ).toEqual(answers.answers)
  expect(
    beforeWithdrawal.participationEvents.find(
      (record) => record.id === owner.consentId,
    )?.data,
  ).not.toHaveProperty("encryptedEmail")
  expect(
    (await api("survey", { ...answers, answers: { q1: "changed" } })).status,
  ).toBe(409)
  expect(
    (await database.doc("analysisQuestionnaires/analysis-e2e").get()).data(),
  ).toEqual(first)
  await page.goto(firstLink)
  await page.getByRole("button", { name: "メールアドレスを確認する" }).click()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")
  const withdrawal = await api("withdraw-participation", {
    ...owner,
    documentSet: { version: "1.0", sha256: "a".repeat(64) },
    encryptedEmail: request.encryptedEmail,
  })
  expect(await withdrawal.json()).toEqual({
    ok: true,
    deletedCount: 1,
    hasCompletedAnalysis: true,
  })
  expect(
    (await database.doc("analysisQuestionnaires/analysis-e2e").get()).exists,
  ).toBe(false)
  const afterWithdrawal = await readParticipantResearchSnapshot(database)
  const accessAfterWithdrawal = await readParticipantResearchSnapshot(
    database,
    {
      includeAccess: true,
    },
  )
  const retainedHistory = afterWithdrawal.participationEvents.filter(
    (record) => record.data.pseudonym === request.pseudonym,
  )
  expect(retainedHistory).toHaveLength(4)
  expect(
    accessAfterWithdrawal.accessEvents
      ?.filter(
        (record) =>
          record.data.pseudonym === request.pseudonym &&
          record.data.eventType === "withdrawal_accepted",
      )
      .map((record) => record.data.dataPurpose),
  ).toEqual(["test"])
  const retainedRun = accessAfterWithdrawal.analysisRuns?.find(
    (record) => record.id === "analysis-e2e",
  )
  expect(retainedRun?.data).toMatchObject({
    outcome: "completed",
    consentId: owner.consentId,
  })
  expect(retainedRun?.data.submittedAt).toBeDefined()
  expect(retainedRun?.data.questionnaireDeletedAt).toBeDefined()
  expect(retainedRun?.data.attemptDeletedAt).toBeDefined()
  expect(retainedRun?.data).not.toHaveProperty("durationMs")
  expect(retainedRun?.data).not.toHaveProperty("answers")
  expect(
    accessAfterWithdrawal.withdrawalJobs?.some(
      (record) =>
        record.data.pseudonym === owner.pseudonym &&
        record.data.status === "complete",
    ),
  ).toBe(true)
  expect(retainedRun?.data.presentationRecordedAt).toBeDefined()
  expect(retainedRun?.data.submittedAt).toBeDefined()
  for (const field of [
    "answers",
    "_integrity",
    "modelName",
    "documentCount",
    "durationMs",
  ])
    expect(retainedRun?.data).not.toHaveProperty(field)

  expect(retainedHistory).toEqual(
    expect.arrayContaining(
      beforeWithdrawal.participationEvents.filter(
        (record) => record.data.pseudonym === request.pseudonym,
      ),
    ),
  )
  expect(
    afterWithdrawal.analysisQuestionnaires.some(
      (record) => record.id === "analysis-e2e",
    ),
  ).toBe(false)
  expect(
    afterWithdrawal.participationStates.find(
      (record) => record.data.pseudonym === request.pseudonym,
    )?.data.status,
  ).toBe("withdrawn")
  await page.goto(firstLink)
  await page.getByRole("button", { name: "メールアドレスを確認する" }).click()
  await expect(page.getByRole("status")).toContainText(
    "この認証リンクを確認できません",
  )
  const state = await (
    await api("participation-events", { pseudonym: request.pseudonym })
  ).json()
  expect(state.lastWithdrawalId).toBeTruthy()
  const parsedHistory = ListParticipationEventsResponseSchema.parse(state)
  for (const record of state.records)
    expect(record).not.toHaveProperty("createdAt")
  const confirmedHistory = parsedHistory.records.find(
    (record) => record.eventType === "consent",
  )
  expect(confirmedHistory?.consentConfirmedAt).toBeTruthy()
  const withdrawalHistory = parsedHistory.records.find(
    (record) => record.eventType === "withdrawal",
  )
  expect(withdrawalHistory?.withdrawalAcceptedAt).toBeTruthy()
  expect(
    parsedHistory.records.find((record) => record.id === owner.consentId)
      ?.consentRequestedAt,
  ).toBe(firstRequestedAt.toDate().toISOString())
  const renewed = {
    ...request,
    consentId: "ZbCdEfGhIjKlMnOpQrSt",
    expectedWithdrawalId: state.lastWithdrawalId,
    expectedRecoveryId: null as string | null,
    expectedStudyGeneration: null,
  }
  // Advance only the synthetic recipient cooldown; retain the hourly quota.
  const allowNextMail = async () => {
    const limits = await database.collection("supportRateLimits").get()
    for (const limit of limits.docs)
      if (limit.data().lastAttemptAtMs !== undefined)
        await limit.ref.update({ lastAttemptAtMs: Date.now() - 60_000 })
  }
  await allowNextMail()
  expect((await api("send-magic-link", renewed)).status).toBe(409)
  const repository = createParticipantRepository(database)
  const recoveryId = randomUUID()
  const authorization = {
    recoveryId,
    destination: "follow-up-document",
    questionnaireKind: "follow-up",
    expectedStudyGeneration: state.studyGeneration ?? null,
    precedingWithdrawalId: state.lastWithdrawalId,
    actorId: "synthetic-researcher",
    reason: "Synthetic reviewed recovery",
    authorizedAt: new Date(),
  }
  await repository
    .participationState(request.pseudonym)
    .update({ recoveryAuthorization: authorization })
  await repository.participationEvent(recoveryId).set({
    ...authorization,
    pseudonym: request.pseudonym,
    eventType: "recovery_authorized",
  })
  renewed.expectedRecoveryId = recoveryId
  expect((await api("send-magic-link", renewed)).status).toBe(200)
  const renewedRequestedAt = (
    await database.doc(`emailConfirmations/${renewed.consentId}`).get()
  ).data()?.createdAt
  expect(renewedRequestedAt.toMillis()).toBeGreaterThan(
    firstRequestedAt.toMillis(),
  )
  expect(
    (await database.doc(`participationEvents/${renewed.consentId}`).get())
      .exists,
  ).toBe(false)
  expect(
    (
      await api("verify-authentication", {
        ...owner,
        consentId: renewed.consentId,
      })
    ).status,
  ).toBe(409)
  const renewedMail = mail.messages.at(-1)
  if (!renewedMail) throw new Error("Expected renewal mail")
  await page.goto(renewedMail.confirmationUrl)
  await page.getByRole("button", { name: "メールアドレスを確認する" }).click()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")
  const confirmedRecovery = (
    await repository.participationState(request.pseudonym).get()
  ).data()?.recoveryAuthorization
  await page.goto(renewedMail.confirmationUrl)
  await page.getByRole("button", { name: "メールアドレスを確認する" }).click()
  await expect(page.getByRole("status")).toContainText("メール確認は完了")
  expect(
    (await repository.participationState(request.pseudonym).get()).data()
      ?.recoveryAuthorization,
  ).toEqual(confirmedRecovery)
  expect(
    (
      await api("verify-authentication", {
        ...owner,
        consentId: renewed.consentId,
      })
    ).status,
  ).toBe(200)
  expect(
    (await api("analysis-completion", { ...metadata, analysisId: "stale" }))
      .status,
  ).toBe(409)
  const retainedRunBeforeReuse = (
    await repository.analysisRun(metadata.analysisId).get()
  ).data()
  const stateBeforeReuse = (
    await repository.participationState(request.pseudonym).get()
  ).data()
  const reusedStart = await api("analysis-attempt", {
    ...owner,
    consentId: renewed.consentId,
    analysisId: metadata.analysisId,
    outcome: "started",
    startedAtMs: Date.now(),
    documentGraphemeCounts: [12],
  })
  expect(reusedStart.status).toBe(409)
  expect(await reusedStart.json()).toMatchObject({
    code: "ANALYSIS_EVENT_CONFLICT",
  })
  expect(
    (await repository.analysisRun(metadata.analysisId).get()).data(),
  ).toEqual(retainedRunBeforeReuse)
  expect(
    (await repository.participationState(request.pseudonym).get()).data(),
  ).toEqual(stateBeforeReuse)
  expect(
    (await repository.analysisAttempt(metadata.analysisId).get()).exists,
  ).toBe(false)
  const afterRenewal = await readParticipantResearchSnapshot(database)
  const renewedAccess = await readParticipantResearchSnapshot(database, {
    includeAccess: true,
  })
  expect(
    renewedAccess.accessEvents
      ?.filter(
        (record) =>
          record.data.pseudonym === request.pseudonym &&
          record.data.eventType === "recovery_consumed",
      )
      .map((record) => record.data.dataPurpose),
  ).toEqual(["test"])
  const renewedHistory = afterRenewal.participationEvents.filter(
    (record) => record.data.pseudonym === request.pseudonym,
  )
  expect(renewedHistory).toHaveLength(7)
  expect(renewedHistory).toEqual(expect.arrayContaining(retainedHistory))
  expect(
    renewedHistory.find((record) => record.id === renewed.consentId)?.data,
  ).toMatchObject({
    eventType: "consent",
    precedingWithdrawalId: state.lastWithdrawalId,
    consentRequestedAt: {
      seconds: renewedRequestedAt.seconds,
      nanoseconds: renewedRequestedAt.nanoseconds,
    },
  })
  expect(
    (
      await api("withdraw-participation", {
        ...owner,
        consentId: renewed.consentId,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: request.encryptedEmail,
      })
    ).status,
  ).toBe(200)
  const afterSecondWithdrawal = await readParticipantResearchSnapshot(database)
  const finalHistory = afterSecondWithdrawal.participationEvents.filter(
    (record) => record.data.pseudonym === request.pseudonym,
  )
  expect(finalHistory).toHaveLength(9)
  expect(finalHistory).toEqual(expect.arrayContaining(renewedHistory))

  // Browser/session reset cannot erase the participant's retained server boundary.
  expect(
    (
      await fetch(`${origin}/api/debug/reset-participation`, {
        method: "POST",
        headers: {
          authorization: `Bearer local.${CALLER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await readParticipantResearchSnapshot(database)
    ).participationEvents.filter(
      (record) => record.data.pseudonym === request.pseudonym,
    ),
  ).toEqual(finalHistory)
})

test("two browsers share the initial study fence and gain parallel follow-up admission only after acceptance", async () => {
  const repository = createParticipantRepository(database)
  const pid = `parallel-${randomUUID()}`
  const owners = ["A", "B"].map((browser) => ({
    serverId: "server-1",
    pseudonym: pid,
    clientId: `browser-${browser}`,
    consentId: randomUUID().replaceAll("-", "").slice(0, 20),
  }))
  for (const owner of owners) {
    expect(
      (
        await api("send-magic-link", {
          ...owner,
          email: `${owner.clientId}-${pid}@example.invalid`,
          documentSet: { version: "1.0", sha256: "a".repeat(64) },
          encryptedEmail: "synthetic-ciphertext",
          expectedWithdrawalId: null,
          expectedRecoveryId: null as string | null,
          expectedStudyGeneration: null,
          expiresAtMs: Date.now() + 3600_000,
        })
      ).status,
    ).toBe(200)
    const message = mail.messages.at(-1)
    if (!message) throw new Error("Synthetic mail missing")
    const confirmation = Object.fromEntries(
      new URLSearchParams(new URL(message.confirmationUrl).hash.slice(1)),
    )
    expect(
      (
        await fetch(`${origin}/email/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", origin },
          body: JSON.stringify(confirmation),
        })
      ).status,
    ).toBe(200)
  }
  const startedAtMs = Date.now()
  const starts = owners.map((owner, index) => ({
    ...owner,
    analysisId: `${pid}-${index}`,
    outcome: "started",
    startedAtMs,
    documentGraphemeCounts: [100],
  }))
  const outcomes = await Promise.all(
    starts.map((body) => api("analysis-attempt", body)),
  )
  expect(outcomes.map((response) => response.status).sort()).toEqual([200, 409])
  const winnerIndex = outcomes.findIndex((response) => response.status === 200)
  expect(await outcomes[winnerIndex].json()).toEqual({
    ok: true,
    questionnaireKind: "initial",
  })
  const winner = owners[winnerIndex]
  const loser = owners[1 - winnerIndex]
  const analysisId = starts[winnerIndex].analysisId
  expect((await api("verify-authentication", loser)).status).toBe(409)
  expect(
    (
      await api("analysis-attempt", {
        ...winner,
        analysisId,
        outcome: "completed",
        endedAtMs: startedAtMs + 1,
        durationMs: 1,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-completion", {
        analysisWorkspaceVersion: "1.0.0",
        ...winner,
        analysisId,
        documentCount: 1,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-attempt", {
        ...winner,
        analysisId,
        outcome: "presented",
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-attempt", {
        ...winner,
        analysisId: `${pid}-repeat`,
        outcome: "started",
        startedAtMs,
        documentGraphemeCounts: [100],
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await api("survey", {
        ...winner,
        analysisId,
        questionnaire: {
          kind: "initial",
          definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
        },
        answers: { q1: "synthetic" },
      })
    ).status,
  ).toBe(200)
  expect(
    await (await api("verify-authentication", loser)).json(),
  ).toMatchObject({ ok: true, questionnaireKind: "follow-up" })
  const originalAttempt = (
    await repository.analysisAttempt(analysisId).get()
  ).data()
  expect(
    await (await api("analysis-attempt", starts[winnerIndex])).json(),
  ).toEqual({ ok: true, questionnaireKind: "initial" })
  expect((await repository.analysisAttempt(analysisId).get()).data()).toEqual(
    originalAttempt,
  )
  const followUps = await Promise.all(
    owners.map((owner, index) =>
      api("analysis-attempt", {
        ...owner,
        analysisId: `${pid}-follow-${index}`,
        outcome: "started",
        startedAtMs,
        documentGraphemeCounts: [100],
      }),
    ),
  )
  expect(followUps.map((response) => response.status)).toEqual([200, 200])
  for (const response of followUps)
    expect(await response.json()).toEqual({
      ok: true,
      questionnaireKind: "follow-up",
    })
  const snapshot = await repository.participationState(pid).get()
  expect(snapshot.data()?.initialSurveyAcceptedAt).toBeDefined()
})

// These transaction tests seed confirmed synthetic consent without sending mail.
async function seedRecoveryOwner() {
  const id = randomUUID()
  const owner = {
    pseudonym: `recovery-${id}`,
    consentId: `consent-${id}`,
    clientId: "recovery-browser",
    serverId: "server-1",
  }
  const repository = createParticipantRepository(database)
  await repository.participationState(owner.pseudonym).set({
    pseudonym: owner.pseudonym,
    status: "active",
    consentBoundaryId: null,
  })
  await repository.participationEvent(owner.consentId).set({
    ...owner,
    eventType: "consent",
    authenticationVersion: 2,
    precedingWithdrawalId: null,
    dataPurpose: "test",
  })
  return { owner, repository }
}

test("state lookup returns only the current boundary and unused grant, and rejects orphaned history", async () => {
  const { owner, repository } = await seedRecoveryOwner()
  const stateRef = repository.participationState(owner.pseudonym)
  const grant = { recoveryId: randomUUID(), destination: "follow-up-document" }
  await stateRef.set(
    {
      lastWithdrawalId: "synthetic-withdrawal",
      recoveryAuthorization: { ...grant, reason: "private synthetic reason" },
    },
    { merge: true },
  )
  const response = await api("participation-state", {
    pseudonym: owner.pseudonym,
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    studyGeneration: null,
    lastWithdrawalId: "synthetic-withdrawal",
    pendingRecovery: grant,
  })
  await stateRef.set(
    { recoveryAuthorization: { ...grant, usedConsentId: owner.consentId } },
    { merge: true },
  )
  expect(
    await (
      await api("participation-state", { pseudonym: owner.pseudonym })
    ).json(),
  ).toEqual({ studyGeneration: null, lastWithdrawalId: "synthetic-withdrawal" })
  await stateRef.delete()
  expect(
    (await api("participation-state", { pseudonym: owner.pseudonym })).status,
  ).toBe(409)
  expect(
    await (
      await api("participation-state", { pseudonym: `new-${randomUUID()}` })
    ).json(),
  ).toEqual({ studyGeneration: null, lastWithdrawalId: null })
})

test("lost initial output retains attempt history and fixes the first presented result to its survey", async () => {
  const { owner, repository } = await seedRecoveryOwner()
  const analysisId = `${owner.pseudonym}-lost`
  const started = {
    ...owner,
    analysisId,
    outcome: "started",
    startedAtMs: 1000,
    documentGraphemeCounts: [100],
  }
  const completed = {
    ...owner,
    analysisId,
    outcome: "completed",
    endedAtMs: 2000,
    durationMs: 1000,
  }
  const metadata = {
    ...owner,
    analysisId,
    analysisWorkspaceVersion: "1.0.0",
    documentCount: 1,
  }
  const unavailable = {
    ...owner,
    analysisId,
    outcome: "unavailable",
    reason: "result_unavailable",
  }
  expect((await api("analysis-attempt", started)).status).toBe(200)
  expect((await api("analysis-attempt", completed)).status).toBe(200)
  expect((await api("analysis-completion", metadata)).status).toBe(200)
  expect((await api("analysis-attempt", unavailable)).status).toBe(200)
  const lost = (await repository.analysisAttempt(analysisId).get()).data()
  expect(lost).toMatchObject({
    outcome: "completed",
    start: started,
    end: completed,
    unavailability: unavailable,
    dataPurpose: "test",
  })
  expect(lost?.resultUnavailableAt).toBeDefined()
  expect(
    (await repository.participationState(owner.pseudonym).get()).data()
      ?.initialAnalysis,
  ).toBeNull()
  const replacementId = `${owner.pseudonym}-replacement`
  expect(
    (await api("analysis-attempt", { ...started, analysisId: replacementId }))
      .status,
  ).toBe(200)
  // A lost-response retry stays historical and cannot clear the new claim.
  expect((await api("analysis-attempt", unavailable)).status).toBe(200)
  expect((await api("analysis-attempt", completed)).status).toBe(200)
  expect((await repository.analysisAttempt(analysisId).get()).data()).toEqual(
    lost,
  )
  expect(
    (await repository.participationState(owner.pseudonym).get()).data()
      ?.initialAnalysis,
  ).toMatchObject({ analysisId: replacementId, presented: false })
  expect((await api("analysis-completion", metadata)).status).toBe(409)
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId,
        outcome: "presented",
      })
    ).status,
  ).toBe(409)
  expect((await api("analysis-attempt", started)).status).toBe(409)
  expect(
    (await api("analysis-attempt", { ...completed, analysisId: replacementId }))
      .status,
  ).toBe(200)
  expect(
    (
      await api("analysis-completion", {
        ...metadata,
        analysisId: replacementId,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId: replacementId,
        outcome: "presented",
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-attempt", {
        ...unavailable,
        analysisId: replacementId,
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await api("analysis-attempt", {
        ...started,
        analysisId: `${analysisId}-extra`,
      })
    ).status,
  ).toBe(409)
  const survey = {
    ...owner,
    analysisId,
    questionnaire: {
      kind: "initial",
      definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
    },
    answers: { q1: "synthetic answer" },
  }
  expect((await api("survey", survey)).status).toBe(409)
  expect(
    (await api("survey", { ...survey, analysisId: replacementId })).status,
  ).toBe(200)
  expect(
    (await repository.participationState(owner.pseudonym).get()).data(),
  ).toMatchObject({ studyStatus: "follow-up", initialAnalysis: null })
  const research = await readParticipantResearchSnapshot(database)
  expect(
    research.attempts.find((attempt) => attempt.id === analysisId)?.data,
  ).toMatchObject({ end: completed, unavailability: unavailable })
})

test("Firestore commits either presentation or output-loss recovery during a race", async () => {
  const { owner, repository } = await seedRecoveryOwner()
  const analysisId = `${owner.pseudonym}-race`
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId,
        outcome: "started",
        startedAtMs: 1000,
        documentGraphemeCounts: [100],
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-attempt", {
        ...owner,
        analysisId,
        outcome: "completed",
        endedAtMs: 2000,
        durationMs: 1000,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await api("analysis-completion", {
        analysisWorkspaceVersion: "1.0.0",
        ...owner,
        analysisId,
        documentCount: 1,
      })
    ).status,
  ).toBe(200)
  const outcomes = await Promise.all([
    api("analysis-attempt", { ...owner, analysisId, outcome: "presented" }),
    api("analysis-attempt", {
      ...owner,
      analysisId,
      outcome: "unavailable",
      reason: "result_unavailable",
    }),
  ])
  expect(outcomes.map((response) => response.status).sort()).toEqual([200, 409])
  const attempt = (await repository.analysisAttempt(analysisId).get()).data()
  expect(Boolean(attempt?.resultUnavailableAt)).not.toBe(
    Boolean(attempt?.presentationRecordedAt),
  )
})

for (const destination of [
  "initial-document",
  "initial-survey",
  "follow-up-document",
]) {
  test(`Firestore consumes reviewed ${destination} and preserves recovery provenance`, async () => {
    const repository = createParticipantRepository(database)
    const id = randomUUID()
    const original = {
      pseudonym: `admin-recovery-${id}`,
      serverId: "server-1",
      clientId: "original-browser",
      consentId: id.replaceAll("-", "").slice(0, 20),
    }
    const email = `${id}@example.invalid`
    const expiresAtMs = Date.now() + 3600000
    const issue = async (
      owner: typeof original,
      expectedRecoveryId: string | null = null,
    ) =>
      api("send-magic-link", {
        ...owner,
        email,
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
        encryptedEmail: "synthetic-email-ciphertext",
        expectedWithdrawalId: null,
        expectedRecoveryId,
        expectedStudyGeneration: null,
        expiresAtMs,
      })
    const confirm = async () => {
      const url = new URL(mail.messages.at(-1)?.confirmationUrl ?? "")
      return fetch(`${origin}/email/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin },
        body: JSON.stringify(
          Object.fromEntries(new URLSearchParams(url.hash.slice(1))),
        ),
      })
    }
    expect((await issue(original)).status).toBe(200)
    expect((await confirm()).status).toBe(200)
    expect(
      (
        await database.doc(`emailConfirmations/${original.consentId}`).get()
      ).data(),
    ).not.toHaveProperty("expireAt")
    const analysisId = `analysis-${id}`
    expect(
      (
        await api("analysis-attempt", {
          ...original,
          analysisId,
          outcome: "started",
          startedAtMs: Date.now(),
          documentGraphemeCounts: [100],
        })
      ).status,
    ).toBe(200)
    const start = (await repository.analysisAttempt(analysisId).get()).data()
      ?.startedAtMs
    expect(
      (
        await api("analysis-attempt", {
          ...original,
          analysisId,
          outcome: "completed",
          endedAtMs: start + 1000,
          durationMs: 1000,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await api("analysis-completion", {
          analysisWorkspaceVersion: "1.0.0",
          ...original,
          analysisId,
          documentCount: 1,
        })
      ).status,
    ).toBe(200)
    // Administrator reviewed actual viewing; do not fabricate a display timestamp.
    const recoveryId = randomUUID()
    const grant = {
      recoveryId,
      destination,
      expectedStudyGeneration: null,
      precedingWithdrawalId: null,
      actorId: "synthetic-reviewer",
      reason: "Reviewed synthetic incident",
      ...(destination === "initial-survey"
        ? { analysisId, sourceOwner: original }
        : {}),
    }
    await repository
      .participationState(original.pseudonym)
      .update({ recoveryAuthorization: grant })
    await repository.participationEvent(recoveryId).set({
      ...grant,
      pseudonym: original.pseudonym,
      eventType: "recovery_authorized",
    })
    expect((await api("verify-authentication", original)).status).toBe(409)
    for (const limit of (await database.collection("supportRateLimits").get())
      .docs)
      if (limit.data().lastAttemptAtMs !== undefined)
        await limit.ref.update({ lastAttemptAtMs: Date.now() - 60_000 })
    const renewed = {
      ...original,
      clientId: "renewed-browser",
      consentId: randomUUID().replaceAll("-", "").slice(0, 20),
    }
    expect((await issue(renewed, recoveryId)).status).toBe(200)
    expect((await confirm()).status).toBe(200)
    const state = (
      await repository.participationState(original.pseudonym).get()
    ).data()
    expect(state?.recoveryAuthorization.usedConsentId).toBe(renewed.consentId)
    const proofRef = database.doc(`emailConfirmations/${renewed.consentId}`)
    const proofBefore = JSON.stringify((await proofRef.get()).data())
    const mailCount = mail.messages.length
    // Reconcile the original issuance after confirmation consumed the grant.
    expect((await issue(renewed, recoveryId)).status).toBe(200)
    expect(mail.messages).toHaveLength(mailCount)
    expect(JSON.stringify((await proofRef.get()).data()) === proofBefore).toBe(
      true,
    )
    expect(
      (await repository.participationState(original.pseudonym).get()).data(),
    ).toEqual(state)
    const verification = await api("verify-authentication", renewed)
    expect(verification.status).toBe(200)
    const verified = await verification.json()
    expect(verified.questionnaireKind).toBe(
      destination === "follow-up-document" ? "follow-up" : "initial",
    )
    if (destination === "initial-survey") {
      expect(verified.recovery).toMatchObject({
        recoveryId,
        destination,
        analysisId,
      })
      const submission = {
        ...renewed,
        analysisId,
        questionnaire: {
          kind: "initial",
          definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
        },
        answers: { q1: "Synthetic answer" },
      }
      expect((await api("survey", submission)).status).toBe(200)
      const accepted = (
        await repository.analysisQuestionnaire(analysisId).get()
      ).data()
      expect(accepted).toMatchObject(original)
      expect(accepted).toMatchObject({
        analysisWorkspaceVersion: "1.0.0",
        _integrity: { metadata: { analysisWorkspaceVersion: "1.0.0" } },
      })
      expect(accepted).not.toHaveProperty("presentationRecordedAt")
      const acceptedState = (
        await repository.participationState(original.pseudonym).get()
      ).data()
      expect(acceptedState).toMatchObject({
        studyStatus: "follow-up",
        initialAnalysis: null,
      })
      expect(acceptedState?.initialSurveyAcceptedAt).toBeDefined()
      const afterAcceptance = await api("verify-authentication", renewed)
      expect(afterAcceptance.status).toBe(200)
      expect(await afterAcceptance.json()).toMatchObject({
        ok: true,
        questionnaireKind: "follow-up",
      })
      expect(accepted?.recoverySubmission).toMatchObject({
        recoveryId,
        consentId: renewed.consentId,
      })
      expect((await api("survey", submission)).status).toBe(200)
      expect(
        (await repository.analysisQuestionnaire(analysisId).get()).data(),
      ).toEqual(accepted)
      expect(
        (await repository.participationState(original.pseudonym).get()).data(),
      ).toEqual(acceptedState)
      expect(
        (
          await api("survey", {
            ...submission,
            answers: { q1: "Changed answer" },
          })
        ).status,
      ).toBe(409)
    }
  })
}
