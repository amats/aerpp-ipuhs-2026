import { randomUUID } from "node:crypto"
import { beforeEach, expect, it, vi } from "vitest"

const { jar, verify } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  verify: vi.fn(),
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}))
vi.mock("@/features/auth/auth-service", () => ({
  verifyAuthentication: verify,
}))
vi.mock("@/features/auth/auth-session", () => ({
  readLocalAuthenticationFromSession: async () => ({}),
  isLocallyAuthenticated: () => true,
}))

import { readStepStateFromSession } from "@/features/app-context/step-state-session"
import { getSession } from "@/lib/session"
import { resetSession } from "./reset-session-service"

beforeEach(() => {
  jar.clear()
  verify
    .mockReset()
    .mockResolvedValue({ ok: true, authVerifiedAt: new Date().toISOString() })
})
async function originalSession() {
  const scope = randomUUID()
  const session = await getSession(scope)
  Object.assign(session, {
    coordinationId: scope,
    stage: "follow_up",
    rootStep: "thanks",
    clientId: "client-1",
    pseudonym: "participant-1",
    consentId: "consent-1",
    activeAnalysisId: "old-active",
    lastCompletedAnalysisId: "old-result",
    pendingSurveyAnalysisId: "old-pending",
    submittedAnalysisId: "old-submitted",
  })
  await session.save()
  return scope
}

it.each([
  ["unauthenticated", "consent"],
  ["confirmation_sent", "auth"],
  ["authenticated", "result"],
  ["follow_up", "thanks"],
  ["withdrawn", "withdrawn"],
])(
  "resets %s/%s to start without retaining identity or reading Support",
  async (stage, step) => {
    const scope = await originalSession()
    const session = await getSession(scope)
    session.stage = stage
    session.rootStep = step
    session.authVerifiedAt = new Date().toISOString()
    await session.save()
    const oldCookie = [...jar.values()][0]
    const next = randomUUID()
    verify.mockRejectedValue(new Error("Support unavailable"))
    await resetSession(scope, next)
    expect(jar.size).toBe(0)
    const fresh = await getSession(next)
    expect(await readStepStateFromSession(fresh)).toEqual({
      stage: "unauthenticated",
      step: "start",
    })
    for (const field of [
      "consentId",
      "email",
      "clientId",
      "pseudonym",
      "authVerifiedAt",
      "preparedConsentContext",
      "activeAnalysisId",
      "lastCompletedAnalysisId",
      "pendingSurveyAnalysisId",
      "submittedAnalysisId",
    ])
      expect(fresh).not.toHaveProperty(field)
    expect(verify).not.toHaveBeenCalled()
    jar.set(`aerpp-session-${scope}`, oldCookie ?? "")
    await expect(getSession(scope)).rejects.toThrow(
      "session_snapshot_unavailable",
    )
    await expect(session.save()).rejects.toThrow("stale_session_state")
  },
)
