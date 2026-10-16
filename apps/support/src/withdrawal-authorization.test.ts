import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { SUPPORT_ROUTES } from "@aerpp/config/support-routes"
import type { Firestore } from "@google-cloud/firestore"
import { expect, it, vi } from "vitest"
import { MemoryFirestore, Timestamp } from "../test-support/firestore.js"
import { CALLER_SECRET, syntheticRuntime } from "../test-support/runtime.js"

vi.mock("@google-cloud/firestore", () => ({
  Timestamp,
  FieldValue: { serverTimestamp: () => Timestamp.now() },
}))

import { createSupportApp } from "./app.js"
import { MailSink } from "./mail.js"

it("rejects withdrawal from a different unconfirmed client and preserves confirmed participation", async () => {
  const db = new MemoryFirestore()
  const runtime = syntheticRuntime()
  const mail = new MailSink()
  const app = createSupportApp(runtime, db as unknown as Firestore, mail)
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  runtime.baseUrl = origin
  const post = (path: string, body: unknown) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin,
        authorization: `Bearer local.${CALLER_SECRET}`,
      },
      body: JSON.stringify(body),
    })
  try {
    const owner = {
      serverId: "server-1",
      clientId: "victim-client",
      pseudonym: "synthetic-victim",
      consentId: "A".repeat(20),
    }
    const request = {
      ...owner,
      email: "victim@example.invalid",
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      encryptedEmail: "synthetic-ciphertext",
      expiresAtMs: Date.now() + 3600000,
      expectedWithdrawalId: null,
      expectedRecoveryId: null,
      expectedStudyGeneration: null,
    }
    expect((await post(SUPPORT_ROUTES.sendMagicLink, request)).status).toBe(200)
    const confirmation = Object.fromEntries(
      new URLSearchParams(
        new URL(mail.messages[0].confirmationUrl).hash.slice(1),
      ),
    )
    expect((await post("/email/confirm", confirmation)).status).toBe(200)
    expect(
      (
        await post(SUPPORT_ROUTES.recordAnalysisAttempt, {
          ...owner,
          analysisId: "victim-analysis",
          outcome: "started",
          startedAtMs: Date.now(),
          documentGraphemeCounts: [10],
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await post(SUPPORT_ROUTES.recordAnalysisAttempt, {
          ...owner,
          analysisId: "victim-analysis",
          outcome: "completed",
          endedAtMs: Date.now(),
          durationMs: 1,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await post(SUPPORT_ROUTES.recordAnalysisCompletion, {
          ...owner,
          analysisId: "victim-analysis",
          analysisWorkspaceVersion: "1.0.0",
          modelName: "synthetic",
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await post(SUPPORT_ROUTES.recordAnalysisAttempt, {
          ...owner,
          analysisId: "victim-analysis",
          outcome: "presented",
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await post(SUPPORT_ROUTES.submitSurvey, {
          ...owner,
          analysisId: "victim-analysis",
          questionnaire: {
            kind: "initial",
            definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
          },
          answers: { q1: "synthetic answer" },
        })
      ).status,
    ).toBe(200)
    expect(
      db.data("analysisQuestionnaires/victim-analysis")?.submittedAt,
    ).toBeDefined()

    const attacker = {
      ...owner,
      clientId: "unconfirmed-client",
      consentId: "B".repeat(20),
    }
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000)
    expect(
      (await post(SUPPORT_ROUTES.sendMagicLink, { ...request, ...attacker }))
        .status,
    ).toBe(200)
    expect(db.data(`emailConfirmations/${attacker.consentId}`)?.status).toBe(
      "sent",
    )
    expect(db.data(`participationEvents/${attacker.consentId}`)).toBeUndefined()
    const withdrawn = await post(SUPPORT_ROUTES.withdrawParticipation, {
      ...attacker,
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      encryptedEmail: "synthetic-ciphertext",
    })
    expect(withdrawn.status).toBe(401)
    expect(await withdrawn.json()).toMatchObject({
      code: "AUTHENTICATION_INVALID",
    })
    expect(
      db.data("analysisQuestionnaires/victim-analysis")?.submittedAt,
    ).toBeDefined()
    const authorized = await post(SUPPORT_ROUTES.withdrawParticipation, {
      ...owner,
      documentSet: { version: "1.0", sha256: "a".repeat(64) },
      encryptedEmail: "synthetic-ciphertext",
    })
    expect(await authorized.json()).toMatchObject({ ok: true, deletedCount: 1 })
    expect(db.data("analysisQuestionnaires/victim-analysis")).toBeUndefined()
    const withdrawalBefore = [...db.records.values()].find(
      (record) => record.eventType === "withdrawal",
    )
    expect(withdrawalBefore?.documentSet).toEqual(request.documentSet)
    const retry = await post(SUPPORT_ROUTES.withdrawParticipation, {
      ...owner,
      documentSet: { version: "2.0", sha256: "b".repeat(64) },
      encryptedEmail: "synthetic-ciphertext",
    })
    expect(retry.status).toBe(200)
    const withdrawalsAfter = [...db.records.values()].filter(
      (record) => record.eventType === "withdrawal",
    )
    expect(withdrawalsAfter).toEqual([withdrawalBefore])
  } finally {
    vi.restoreAllMocks()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
