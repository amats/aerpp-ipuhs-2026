import { createHash, randomUUID } from "node:crypto"
import { env } from "@aerpp/config/server/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  confirmAuthenticationAndPrepareAnalysisAction,
  prepareConsentContextAction,
  sendConsentEmailAndMoveToAuthAction,
} from "@/features/app-context/actions-step-state"
import { createPseudonym } from "@/features/identity/participant-identifiers"
import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import { getSession, getSessionToken } from "@/lib/session"
import * as authority from "@/lib/session-authority"
import { admitSessionAction } from "./actions-session"
import { handleAdminRecovery } from "./admin-recovery-service"

const { jar, participantFetch } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  participantFetch: vi.fn(),
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  }),
}))
vi.mock("@/lib/fetch-with-retry", () => ({ fetchWithRetry: participantFetch }))
beforeEach(() => {
  jar.clear()
  participantFetch.mockReset()
})
afterEach(() => vi.restoreAllMocks())

for (const destination of [
  "initial-document",
  "initial-survey",
  "follow-up-document",
] as const) {
  it.each(["mail-response-lost", "local-save-failed"])(
    `reconciles confirmed ${destination} after %s and reload using the same saved request`,
    async (failure) => {
      const recovery = {
        recoveryId: randomUUID(),
        destination,
        ...(destination === "initial-survey"
          ? { analysisId: randomUUID() }
          : {}),
      }
      let consumed = false
      let consentId: string | undefined
      const mailHashes: string[] = []
      participantFetch.mockImplementation(
        async (url: string, init: RequestInit) => {
          if (url === env.getParticipationStateUrl)
            return Response.json({
              lastWithdrawalId: null,
              studyGeneration: consumed ? recovery.recoveryId : null,
              ...(consumed ? {} : { pendingRecovery: recovery }),
            })
          if (url === env.sendMagicLinkUrl) {
            const text = String(init.body)
            mailHashes.push(createHash("sha256").update(text).digest("hex"))
            consentId = JSON.parse(text).consentId
            // Email is confirmed independently, before Web can save its next stage.
            consumed = true
            if (mailHashes.length === 1 && failure === "mail-response-lost")
              throw new Error("Synthetic lost mail acknowledgement")
            return Response.json({ ok: true, consentId })
          }
          if (url === env.verifyAuthenticationUrl) {
            expect(JSON.parse(String(init.body)).consentId === consentId).toBe(
              true,
            )
            return Response.json({
              ok: true,
              questionnaireKind:
                destination === "follow-up-document" ? "follow-up" : "initial",
              ...(destination === "initial-survey" ? { recovery } : {}),
            })
          }
          throw new Error("Unexpected synthetic URL")
        },
      )
      const id = randomUUID()
      expect(await admitSessionAction(id)).toMatchObject({ ok: true })
      const email = "recovery-test@example.invalid"
      const original = await getSession(id)
      Object.assign(original, {
        pseudonym: createPseudonym(email),
        clientId: "aerpp:cid-original",
        consentId: "OriginalConsent00001",
        stage: "authenticated",
        rootStep: "document",
      })
      await original.save()
      const request = {
        intent: "begin" as const,
        recoveryId: recovery.recoveryId,
      }
      expect(
        await handleAdminRecovery(getSessionToken(id), request),
      ).toMatchObject({ ok: true })
      expect(
        await handleAdminRecovery(getSessionToken(id), {
          ...request,
          intent: "ready",
        }),
      ).toMatchObject({ ok: true })
      const prepared = await prepareConsentContextAction(
        email,
        getSessionToken(id),
        readDisplayedDocumentSet().sha256,
      )
      expect(prepared.ok).toBe(true)
      if (!("browserContext" in prepared) || !("consentContext" in prepared))
        throw new Error("Missing preparation")
      let privateContext = prepared.browserContext
      const token = () => `${getSessionToken(id)}:${privateContext}`
      const adoptContext = (result: object) => {
        if ("browserContext" in result) privateContext = result.browserContext
      }
      const update = authority.updateAuthority
      let rejectedLocalCommit = false
      if (failure === "local-save-failed")
        vi.spyOn(authority, "updateAuthority").mockImplementation(
          (scope, change) =>
            update(scope, (record) => {
              const next = change(record)
              if (
                rejectedLocalCommit !== true &&
                next?.state &&
                JSON.parse(next.state).stage === "confirmation_sent"
              ) {
                rejectedLocalCommit = true
                return null
              }
              return next
            }),
        )
      const sent = await sendConsentEmailAndMoveToAuthAction(
        email,
        token(),
        prepared.consentContext,
      )
      expect(sent).toMatchObject({
        ok: false,
        reason:
          failure === "mail-response-lost"
            ? "send_failed"
            : "step_state_write_failed",
      })
      expect(rejectedLocalCommit).toBe(failure === "local-save-failed")
      adoptContext(sent)
      expect(await admitSessionAction(id)).toMatchObject({
        ok: true,
        stepState: { stage: "unauthenticated", step: "consent" },
      })
      const before = authority.readAuthority(id)
      const retried = await prepareConsentContextAction(
        email,
        token(),
        readDisplayedDocumentSet().sha256,
      )
      expect(retried.ok).toBe(true)
      if (!("consentContext" in retried))
        throw new Error("Missing original retry")
      expect(retried.consentContext === prepared.consentContext).toBe(true)
      expect(authority.readAuthority(id)).toEqual(before)
      expect((await getSession(id)).authVerifiedAt).toBeUndefined()
      const acknowledged = await sendConsentEmailAndMoveToAuthAction(
        email,
        token(),
        retried.consentContext,
      )
      expect(acknowledged.ok).toBe(true)
      adoptContext(acknowledged)
      expect(mailHashes).toHaveLength(2)
      expect(new Set(mailHashes).size).toBe(1)
      expect(
        await confirmAuthenticationAndPrepareAnalysisAction(token()),
      ).toMatchObject({
        ok: true,
        stepState: {
          stage:
            destination === "follow-up-document"
              ? "follow_up"
              : "authenticated",
          step: destination === "initial-survey" ? "survey" : "document",
        },
        ...(destination === "initial-survey"
          ? { recoveredSurveyAnalysisId: recovery.analysisId }
          : {}),
      })
      expect((await getSession(id)).adminRecoveryId).toBeUndefined()
    },
  )
}
