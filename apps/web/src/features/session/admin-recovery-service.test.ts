import { randomUUID } from "node:crypto"
import { beforeEach, expect, it, vi } from "vitest"
import { getSession, getSessionToken } from "@/lib/session"
import { readAuthority, updateAuthority } from "@/lib/session-authority"
import { admitSessionAction } from "./actions-session"
import { handleAdminRecovery } from "./admin-recovery-service"
import { withSessionOperation } from "./session-operation"

const { jar, pending } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  pending: vi.fn(),
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
vi.mock("@/features/auth/auth-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/auth-service")>()),
  readPendingAdminRecovery: pending,
  hasPendingAdminRecovery: async () => (await pending()) !== undefined,
  requiresAdminRecovery: async (session: {
    adminRecoveryCleanupPending?: boolean
  }) => session.adminRecoveryCleanupPending === true,
}))
const recovery = {
  recoveryId: "22222222-2222-4222-8222-222222222222",
  destination: "initial-document" as const,
}
beforeEach(() => {
  jar.clear()
  pending.mockReset().mockResolvedValue(recovery)
})

async function participant() {
  const id = randomUUID()
  const admission = await admitSessionAction(id)
  if (admission.ok !== true) throw new Error("Admission failed")
  const session = await getSession(id)
  Object.assign(session, {
    pseudonym: "synthetic-participant",
    clientId: "original-client",
    consentId: "original-consent",
    stage: "authenticated",
    rootStep: "survey",
    lastCompletedAnalysisId: "original-analysis",
    pendingSurveyAnalysisId: "original-analysis",
    presentedAnalysisId: "original-analysis",
  })
  await session.save()
  return { id, token: getSessionToken(id) }
}

it("preempts stuck work without depending on old private data and resumes an unacknowledged reset", async () => {
  const { id, token } = await participant()
  const credentials = [...jar]
  updateAuthority(id, (record) => ({
    ...record,
    busy: "unverifiable-operation",
  }))
  const request = { intent: "begin" as const, recoveryId: recovery.recoveryId }
  const started = await handleAdminRecovery(
    `${token}:invalid-old-context`,
    request,
  )
  expect(started).toMatchObject({ ok: true, recovery })
  expect([...jar]).toEqual(credentials)
  const reset = await getSession(id)
  expect(reset).toMatchObject({
    stage: "unauthenticated",
    rootStep: "consent",
    adminRecoveryId: recovery.recoveryId,
    adminRecoveryCleanupPending: true,
  })
  expect(reset).not.toHaveProperty("consentId")
  expect(reset).not.toHaveProperty("pendingSurveyAnalysisId")
  expect(reset).not.toHaveProperty("lastCompletedAnalysisId")
  expect(
    await withSessionOperation(getSessionToken(id), "ordinary", async () => ({
      ok: true,
    })),
  ).toMatchObject({ reason: "recovery_required" })
  expect(await handleAdminRecovery(getSessionToken(id), request)).toEqual(
    started,
  )
  expect(
    await handleAdminRecovery(getSessionToken(id), {
      ...request,
      intent: "ready",
    }),
  ).toMatchObject({ ok: true })
  expect(
    await withSessionOperation(token, "ordinary", async () => ({ ok: true })),
  ).toMatchObject({ reason: "stale_session_state" })
  const admitted = await admitSessionAction(id)
  expect(admitted).toMatchObject({ ok: true, recoveryRequired: false })
})

it("keeps a new authentication identity when a duplicate recovery request arrives", async () => {
  const { id, token } = await participant()
  const request = { intent: "begin" as const, recoveryId: recovery.recoveryId }
  await handleAdminRecovery(token, request)
  await handleAdminRecovery(getSessionToken(id), {
    ...request,
    intent: "ready",
  })
  const session = await getSession(id)
  session.consentId = "new-consent"
  session.rootStep = "auth"
  session.stage = "confirmation_sent"
  await session.save()
  const before = readAuthority(id)
  expect(await handleAdminRecovery(getSessionToken(id), request)).toMatchObject(
    { ok: false, reason: "recovery_in_progress" },
  )
  expect(readAuthority(id)).toEqual(before)
})

it("rejects changed grants and stale or missing credentials before resetting local state", async () => {
  const { id, token } = await participant()
  const before = readAuthority(id)
  const request = { intent: "begin" as const, recoveryId: randomUUID() }
  expect(await handleAdminRecovery(token, request)).toMatchObject({
    reason: "recovery_changed",
  })
  expect(readAuthority(id)).toEqual(before)
  pending.mockResolvedValue(undefined)
  expect(await handleAdminRecovery(token, request)).toMatchObject({
    reason: "recovery_not_authorized",
  })
  jar.clear()
  expect(await handleAdminRecovery(token, request)).toMatchObject({
    reason: "session_snapshot_unavailable",
  })
  expect(readAuthority(id)).toEqual(before)
})
