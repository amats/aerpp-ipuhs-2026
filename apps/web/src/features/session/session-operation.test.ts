import { randomUUID } from "node:crypto"
import { beforeEach, expect, it, vi } from "vitest"
import {
  completeWithdrawalAction,
  prepareWithdrawalAction,
} from "@/features/app-context/actions-step-state"
import { createPseudonym } from "@/features/identity/participant-identifiers"
import { readDisplayedDocumentSet } from "@/lib/document-set-reference"
import {
  getSession,
  getSessionForTab,
  getSessionToken,
  revokeSession,
} from "@/lib/session"
import * as sessionAuthority from "@/lib/session-authority"
import {
  readAnalysisOperation,
  readAuthority,
  setAnalysisOperation,
  updateAuthority,
  watchAuthority,
} from "@/lib/session-authority"
import { hashSessionState } from "@/lib/session-state-hash"
import { admitSessionAction } from "./actions-session"
import {
  withSessionOperation,
  withSessionRead,
  withWithdrawalOperation,
} from "./session-operation"
import { readSessionStatus } from "./session-status-service"

const requiresRecovery = vi.hoisted(() => vi.fn(async () => false))
vi.mock("@/features/auth/auth-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/auth-service")>()),
  requiresAdminRecovery: requiresRecovery,
}))
const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }))
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
beforeEach(() => {
  jar.clear()
  requiresRecovery.mockReset().mockResolvedValue(false)
})
async function admitted() {
  const id = randomUUID()
  const result = await admitSessionAction(id)
  if (result.ok !== true) throw new Error("Synthetic admission failed")
  return { id, token: result.sessionToken }
}

it.each(
  [false, undefined, null, "false", 1, {}, []].map((acquired) => ({
    acquired,
  })),
)(
  "does not dispatch a mutation without confirmed acquisition ($acquired)",
  async ({ acquired }) => {
    const { id, token } = await admitted()
    const update = vi
      .spyOn(sessionAuthority, "updateAuthority")
      .mockReturnValue(acquired as boolean)
    const operation = vi.fn(async () => ({ ok: true }))
    try {
      expect(await withSessionOperation(token, "ordinary", operation)).toEqual({
        ok: false,
        reason: "session_busy",
      })
      expect(operation).not.toHaveBeenCalled()
      expect(readAuthority(id)?.busy).toBeNull()
    } finally {
      update.mockRestore()
    }
  },
)

it("interrupts ordinary work when recovery is pending before dispatch or after a rejected upstream write", async () => {
  const { token } = await admitted()
  const operation = vi.fn(async () => ({ ok: true }))
  requiresRecovery.mockResolvedValueOnce(true)
  expect(
    await withSessionOperation(token, "ordinary", operation),
  ).toMatchObject({ ok: false, reason: "recovery_required" })
  expect(operation).not.toHaveBeenCalled()
  requiresRecovery.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(
    await withSessionOperation(token, "survey", async () => ({
      ok: false,
      reason: "submit_failed",
    })),
  ).toMatchObject({ ok: false, reason: "recovery_required" })
})

it("keeps local analysis cancellation independent of recovery lookup availability", async () => {
  const { token } = await admitted()
  requiresRecovery.mockRejectedValueOnce(new Error("Support unavailable"))
  expect(
    await withSessionOperation(token, "analysis_cleanup", async () => ({
      ok: true,
    })),
  ).toMatchObject({ ok: true })
  expect(requiresRecovery).not.toHaveBeenCalled()
})

it("delivers a saved retry context even when the post-failure recovery lookup is unavailable", async () => {
  const { id, token } = await admitted()
  requiresRecovery
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("Support unavailable"))
  const result = await withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    session.email = "synthetic@example.invalid"
    session.preparedConsentContext = "original-retry"
    await session.save()
    return { ok: false, reason: "send_failed" }
  })
  expect(result).toMatchObject({
    ok: false,
    reason: "send_failed",
    sessionToken: getSessionToken(id),
    browserContext: expect.any(String),
  })
  if (!("browserContext" in result)) throw new Error("Missing retry context")
  const restored = await getSessionForTab(
    `${getSessionToken(id)}:${result.browserContext}`,
  )
  expect(restored.preparedConsentContext).toBe("original-retry")
})

it("does not revive an old failure after recovery preempts its final grant check", async () => {
  const { token } = await admitted()
  const entered = Promise.withResolvers<void>()
  const lookup = Promise.withResolvers<boolean>()
  requiresRecovery.mockResolvedValueOnce(false).mockImplementationOnce(() => {
    entered.resolve()
    return lookup.promise
  })
  const old = withSessionOperation(token, "ordinary", async () => ({
    ok: false,
  }))
  await entered.promise
  const auth = await import("@/features/auth/auth-service")
  const authorized = vi
    .spyOn(auth, "hasPendingAdminRecovery")
    .mockResolvedValueOnce(true)
  try {
    const { withAdminRecoveryOperation } = await import("./session-operation")
    expect(
      await withAdminRecoveryOperation(token, async () => ({ ok: true })),
    ).toMatchObject({ ok: true })
    expect(await old).toMatchObject({
      ok: false,
      reason: "superseded_operation",
    })
  } finally {
    lookup.resolve(true)
    authorized.mockRestore()
  }
})

async function authenticatedParticipant() {
  const { id, token } = await admitted()
  const email = "synthetic@example.invalid"
  const prepared = await withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    session.stage = "authenticated"
    session.rootStep = "document"
    session.email = email
    session.consentId = "consent-1"
    session.pseudonym = createPseudonym(email) ?? undefined
    session.clientId = `aerpp:cid-${"c".repeat(32)}`
    await session.save()
    return { ok: true }
  })
  if (!("browserContext" in prepared)) throw new Error("Missing context")
  return {
    id,
    email,
    token: `${getSessionToken(id)}:${prepared.browserContext}`,
  }
}

it("shares one session and hash across every tab without heartbeat writes", async () => {
  const { id, token } = await admitted()
  const before = readAuthority(id)
  const cookies = [...jar]
  const another = await admitSessionAction(id)
  expect(another).toMatchObject({ ok: true, scope: id, sessionToken: token })
  expect(another).not.toHaveProperty("role")
  expect((await readSessionStatus(token))?.admitted).toBe(true)
  expect(readAuthority(id)).toEqual(before)
  expect([...jar]).toEqual(cookies)
  expect(before).not.toHaveProperty("primary")
  expect(before).not.toHaveProperty("sealed")
})

it.each(["", "invalid", `${randomUUID()}:${randomUUID()}`])(
  "rejects an invalid admission scope without issuing credentials: %s",
  async (scope) => {
    expect(await admitSessionAction(scope)).toEqual({
      ok: false,
      reason: "session_invalid",
    })
    expect(jar.size).toBe(0)
  },
)

it("keeps email and sealed retry context only in the browser response, including while busy", async () => {
  const { id, token } = await admitted()
  const credential = [...jar.values()][0]
  const prepared = await withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    session.email = "private@example.invalid"
    session.preparedConsentContext = "private-encrypted-email"
    await session.save()
    expect(JSON.stringify(readAuthority(id))).not.toMatch(/private|example/)
    return { ok: true }
  })
  if (!("browserContext" in prepared)) throw new Error("Missing context")
  expect(prepared).toMatchObject({
    sessionToken: token,
    browserContextRevision: readAuthority(id)?.revision,
  })
  expect([...jar.values()]).toEqual([credential])
  expect((await getSession(id)).email).toBeUndefined()
  const browserToken = `${token}:${prepared.browserContext}`
  await withSessionOperation(browserToken, "ordinary", async () => {
    expect((await getSession()).email).toBe("private@example.invalid")
    expect(JSON.stringify(readAuthority(id))).not.toContain(
      String(prepared.browserContext),
    )
    expect(JSON.stringify(readAuthority(id))).not.toMatch(/private|example/)
    return { ok: true }
  })
  jar.clear()
  const other = await admitted()
  expect(
    await withSessionOperation(
      `${other.token}:${prepared.browserContext}`,
      "ordinary",
      async () => ({ ok: true }),
    ),
  ).toMatchObject({ ok: false })
})

it("does not authenticate a known session ID and hash without its credential", async () => {
  const { token } = await admitted()
  jar.clear()
  const mutation = vi.fn(async () => ({ ok: true }))
  expect(await withSessionOperation(token, "ordinary", mutation)).toMatchObject(
    {
      ok: false,
    },
  )
  expect(mutation).not.toHaveBeenCalled()
})

it("rejects a sealed private context after the same generation changes participant identity", async () => {
  const { id, token } = await admitted()
  const prepared = await withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    session.email = "original@example.invalid"
    session.pseudonym = "original-pid"
    session.consentId = "original-consent"
    await session.save()
    return { ok: true }
  })
  if (!("browserContext" in prepared)) throw new Error("Missing context")
  const changed = await getSession(id)
  changed.stage = "authenticated"
  changed.pseudonym = "other-pid"
  changed.consentId = "other-consent"
  await changed.save()
  const operation = vi.fn(async () => ({ ok: true }))
  expect(
    await withSessionOperation(
      `${getSessionToken(id)}:${prepared.browserContext}`,
      "ordinary",
      operation,
    ),
  ).toMatchObject({ ok: false, reason: "browser_context_invalid" })
  expect(operation).not.toHaveBeenCalled()
})

it("stores allowlisted business state and rejects a stale operation without revoking the session", async () => {
  const { id, token } = await admitted()
  const changed = await withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    session.pseudonym = "synthetic-pid"
    session.clientId = "synthetic-client"
    session.stage = "authenticated"
    session.rootStep = "document"
    await session.save()
    return { ok: true }
  })
  expect(changed).toMatchObject({ ok: true, sessionToken: getSessionToken(id) })
  expect(readAuthority(id)?.hash).toBe(hashSessionState(await getSession(id)))
  expect(JSON.parse(readAuthority(id)?.state ?? "{}")).toMatchObject({
    pseudonym: "synthetic-pid",
    clientId: "synthetic-client",
  })
  const mutation = vi.fn(async () => ({ ok: true }))
  expect(await withSessionOperation(token, "ordinary", mutation)).toMatchObject(
    {
      ok: false,
      reason: "stale_session_state",
    },
  )
  expect(mutation).not.toHaveBeenCalled()
  expect((await getSession(id)).pseudonym).toBe("synthetic-pid")
  expect(
    await withSessionOperation(getSessionToken(id), "ordinary", mutation),
  ).toMatchObject({ ok: true })
})

it("does not change the hash when navigating result and survey views", async () => {
  const { id } = await admitted()
  const session = await getSession(id)
  Object.assign(session, {
    stage: "authenticated",
    rootStep: "result",
    lastCompletedAnalysisId: "analysis-1",
  })
  await session.save()
  const before = readAuthority(id)
  session.rootStep = "survey"
  await session.save()
  expect(readAuthority(id)).toEqual(before)
  expect(hashSessionState({ ...session, rootStep: "result" })).toBe(
    hashSessionState({ ...session, rootStep: "survey" }),
  )
})

it("serializes conflicting server mutations while allowing another tab to read", async () => {
  const { id, token } = await admitted()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const first = withSessionOperation(token, "ordinary", async () => {
    entered.resolve()
    await finish.promise
    return { ok: true }
  })
  await entered.promise
  const during = readAuthority(id)
  expect(
    await withSessionRead(token, async () => ({
      ok: true,
      scope: (await getSession()).coordinationId,
    })),
  ).toMatchObject({ ok: true, scope: id })
  expect(readAuthority(id)).toEqual(during)
  expect(await admitSessionAction(id)).toMatchObject({
    ok: true,
  })
  const mutation = vi.fn(async () => ({ ok: true }))
  expect(await withSessionOperation(token, "ordinary", mutation)).toMatchObject(
    {
      ok: false,
      reason: "session_busy",
    },
  )
  expect(mutation).not.toHaveBeenCalled()
  finish.resolve()
  expect(await first).toMatchObject({ ok: true })
})

it("prevents a read boundary from saving or deleting the selected session", async () => {
  const { id, token } = await admitted()
  const before = readAuthority(id)
  expect(
    await withSessionRead(token, async () => {
      const session = await getSession()
      session.stage = "authenticated"
      await session.save()
      return { ok: true }
    }),
  ).toMatchObject({ ok: false, reason: "session_read_failed" })
  expect(
    await withSessionRead(token, async () => {
      ;(await getSession()).destroy()
      return { ok: true }
    }),
  ).toMatchObject({ ok: false, reason: "session_read_failed" })
  expect(readAuthority(id)).toEqual(before)
  expect((await admitSessionAction(id)).ok).toBe(true)
})

it("rejects a read result when the authority changes while it is pending", async () => {
  const { id, token } = await admitted()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const pending = withSessionRead(token, async () => {
    entered.resolve()
    await finish.promise
    return { ok: true }
  })
  await entered.promise
  const session = await getSession(id)
  session.consentId = "replacement-consent"
  await session.save()
  finish.resolve()
  expect(await pending).toMatchObject({
    ok: false,
    reason: "stale_session_state",
  })
})

it("rejects read continuations and new reads after withdrawal takes priority", async () => {
  const { id, token } = await admitted()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const pending = withSessionRead(token, async () => {
    entered.resolve()
    await finish.promise
    return { ok: true }
  })
  await entered.promise
  updateAuthority(id, (current) => ({ ...current, withdrawing: 1 }))
  finish.resolve()
  expect(await pending).toMatchObject({
    ok: false,
    reason: "stale_session_state",
  })
  const read = vi.fn(async () => ({ ok: true }))
  expect(await withSessionRead(token, read)).toMatchObject({
    ok: false,
    reason: "session_busy",
  })
  expect(read).not.toHaveBeenCalled()
})

it.each([
  { stage: "withdrawn", request: true, busy: null, allowed: true },
  { stage: "authenticated", request: true, busy: null, allowed: false },
  { stage: "withdrawn", request: false, busy: null, allowed: false },
  { stage: "withdrawn", request: true, busy: "cleanup", allowed: false },
])("limits accepted-withdrawal document reads: %j", async (scenario) => {
  const { id, token } = await admitted()
  const prepared = await withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    session.stage = scenario.stage
    session.rootStep = scenario.stage === "withdrawn" ? "withdrawn" : "document"
    if (scenario.request === true)
      session.withdrawalRequest = {
        consentId: "consent-1",
        serverId: "server-id",
        clientId: "client-id",
        pseudonym: "person-1",
        encryptedEmail: "private-ciphertext",
        documentSet: { version: "1.0", sha256: "a".repeat(64) },
      }
    await session.save()
    return { ok: true }
  })
  if (!("sessionToken" in prepared)) throw new Error("Missing token")
  const selected =
    "browserContext" in prepared
      ? `${prepared.sessionToken}:${prepared.browserContext}`
      : prepared.sessionToken
  updateAuthority(id, (current) => ({
    ...current,
    withdrawing: 1,
    busy: scenario.busy,
  }))
  const read = vi.fn(async () => ({ ok: true }))
  expect(
    await withSessionRead(selected, read, { allowAcceptedWithdrawal: true }),
  ).toMatchObject({ ok: scenario.allowed })
  expect(read).toHaveBeenCalledTimes(scenario.allowed === true ? 1 : 0)
  if (scenario.allowed === true) {
    expect(await withSessionRead(selected, read)).toMatchObject({ ok: false })
    expect(
      await withSessionOperation(selected, "ordinary", read),
    ).toMatchObject({ ok: false })
    expect(
      await withSessionRead(
        selected,
        async () => {
          await (await getSession()).save()
          return { ok: true }
        },
        { allowAcceptedWithdrawal: true },
      ),
    ).toMatchObject({ ok: false, reason: "session_read_failed" })
  }
})

it.each([true, false])(
  "restores and validates only already presented results through a retained mutation fence (presented: %s)",
  async (presented) => {
    const { id } = await admitted()
    const session = await getSession(id)
    session.stage = "authenticated"
    session.rootStep = "result"
    session.lastCompletedAnalysisId = "analysis-1"
    if (presented) session.presentedAnalysisId = "analysis-1"
    await session.save()
    updateAuthority(id, (current) => ({
      ...current,
      busy: "interrupted-mutation",
    }))
    const before = readAuthority(id)
    const { recordResultPresentationAction } = await import(
      "@/features/llm/actions-record-presentation"
    )
    const { validateResultAction } = await import(
      "@/features/llm/actions-validate-result"
    )
    expect(
      await recordResultPresentationAction("analysis-1", getSessionToken(id)),
    ).toMatchObject(
      presented ? { ok: true } : { ok: false, reason: "session_busy" },
    )
    expect(
      await validateResultAction("analysis-1", getSessionToken(id)),
    ).toMatchObject(
      presented ? { ok: true } : { ok: false, reason: "analysis_mismatch" },
    )
    expect(readAuthority(id)).toEqual(before)
  },
)

it.each(["b".repeat(64), undefined])(
  "rejects a first withdrawal with an outdated or missing set without fencing the session: %s",
  async (displayedSha256) => {
    const { id, email, token } = await authenticatedParticipant()
    const before = readAuthority(id)
    expect(
      await prepareWithdrawalAction(email, token, displayedSha256),
    ).toMatchObject({ ok: false, reason: "document_set_changed" })
    expect(readAuthority(id)).toEqual(before)
    expect((await getSessionForTab(token)).withdrawalRequest).toBeUndefined()
    expect(await admitSessionAction(id)).toMatchObject({ ok: true })
    expect(
      await withSessionRead(token, async () => ({ ok: true })),
    ).toMatchObject({ ok: true })
    expect(
      await withSessionOperation(token, "ordinary", async () => {
        const session = await getSession()
        session.rootStep = "result"
        await session.save()
        return { ok: true }
      }),
    ).toMatchObject({ ok: true })
    expect(readAuthority(id)?.withdrawing).toBe(0)
  },
)

it("does not preempt an in-flight ordinary operation for an outdated withdrawal set", async () => {
  const { id, email, token } = await authenticatedParticipant()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const ordinary = withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    entered.resolve()
    await finish.promise
    session.rootStep = "result"
    await session.save()
    return { ok: true }
  })
  await entered.promise
  try {
    const before = readAuthority(id)
    expect(
      await prepareWithdrawalAction(email, token, "b".repeat(64)),
    ).toMatchObject({ ok: false, reason: "document_set_changed" })
    expect(readAuthority(id)).toEqual(before)
  } finally {
    finish.resolve()
    expect(await ordinary).toMatchObject({ ok: true })
  }
  expect(readAuthority(id)?.withdrawing).toBe(0)
  expect((await getSessionForTab(getSessionToken(id))).rootStep).toBe("result")
})

it("rejects an unprepared withdrawal without preempting ordinary work", async () => {
  const { id, email, token } = await authenticatedParticipant()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const ordinary = withSessionOperation(token, "ordinary", async () => {
    const session = await getSession()
    entered.resolve()
    await finish.promise
    session.rootStep = "result"
    await session.save()
    return { ok: true }
  })
  await entered.promise
  try {
    const before = readAuthority(id)
    expect(await completeWithdrawalAction(email, token)).toMatchObject({
      ok: false,
      reason: "withdrawal_preparation_required",
    })
    expect(readAuthority(id)).toEqual(before)
  } finally {
    finish.resolve()
    expect(await ordinary).toMatchObject({ ok: true })
  }
  expect(readAuthority(id)?.withdrawing).toBe(0)
})

it("keeps the saved withdrawal request and fence when retrying after a document deployment", async () => {
  const { id, email, token } = await authenticatedParticipant()
  const originalSet = readDisplayedDocumentSet()
  const prepared = await prepareWithdrawalAction(
    email,
    token,
    originalSet.sha256,
  )
  expect(prepared).toMatchObject({ ok: true })
  if (!("browserContext" in prepared)) throw new Error("Missing context")
  const selected = `${getSessionToken(id)}:${prepared.browserContext}`
  const originalRequest = (await getSessionForTab(selected)).withdrawalRequest
  expect(originalRequest).toMatchObject({ documentSet: originalSet })
  expect(readAuthority(id)?.withdrawing).toBe(1)
  const before = readAuthority(id)
  vi.stubEnv(
    "AERPP_WEB_DOCUMENT_SET",
    JSON.stringify({ version: "2.0", sha256: "b".repeat(64) }),
  )
  try {
    expect(
      await prepareWithdrawalAction(email, selected, originalSet.sha256),
    ).toMatchObject({ ok: true })
    expect((await getSessionForTab(selected)).withdrawalRequest).toEqual(
      originalRequest,
    )
    expect(readAuthority(id)).toEqual(before)
    expect(
      await withSessionOperation(selected, "ordinary", async () => ({
        ok: true,
      })),
    ).toMatchObject({ ok: false, reason: "session_busy" })
  } finally {
    vi.unstubAllEnvs()
  }
})

it("permits withdrawal from any current tab and fences an in-flight ordinary write", async () => {
  const { id } = await admitted()
  const prepared = await withSessionOperation(
    getSessionToken(id),
    "ordinary",
    async () => {
      const session = await getSession()
      session.stage = "authenticated"
      session.email = "synthetic@example.invalid"
      await session.save()
      return { ok: true }
    },
  )
  if (!("browserContext" in prepared)) throw new Error("Missing context")
  const token = `${getSessionToken(id)}:${prepared.browserContext}`
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const ordinary = withSessionOperation(token, "ordinary", async () => {
    const pending = await getSession()
    entered.resolve()
    await finish.promise
    pending.rootStep = "result"
    await expect(pending.save()).rejects.toThrow("stale_session_state")
    return { ok: true }
  })
  await entered.promise
  expect(
    await withWithdrawalOperation(
      token,
      "synthetic@example.invalid",
      async () => {
        const current = await getSession()
        current.stage = "withdrawn"
        current.rootStep = "withdrawn"
        await current.save()
        return { ok: true }
      },
    ),
  ).toMatchObject({ ok: true })
  expect(await ordinary).toMatchObject({
    ok: false,
    reason: "superseded_operation",
  })
  finish.resolve()
})

it("recovers a revoked session to fresh authentication and rejects late saves", async () => {
  const { id } = await admitted()
  const pending = await getSession(id)
  await revokeSession(id)
  const recovered = await admitSessionAction(id)
  expect(recovered).toMatchObject({
    ok: true,
    recovered: true,
    stepState: { stage: "unauthenticated", step: "start" },
  })
  if (recovered.ok !== true) throw new Error("Expected recovery")
  expect(recovered.scope).not.toBe(id)
  pending.stage = "authenticated"
  await expect(pending.save()).rejects.toThrow("stale_session_state")
  const cookies = [...jar]
  jar.set(`aerpp-session-${id}.obsolete`, "invalid")
  expect((await getSession(recovered.scope)).stage).toBe("unauthenticated")
  jar.clear()
  for (const [name, value] of cookies) jar.set(name, value)
})

it("keeps accepted analysis running across every tab reload", async () => {
  const { id } = await admitted()
  const session = await getSession(id)
  Object.assign(session, {
    stage: "authenticated",
    rootStep: "result",
    activeAnalysisId: "analysis-1",
  })
  await session.save()
  setAnalysisOperation(id, "analysis-1", "running")
  const before = readAuthority(id)?.hash
  expect(await admitSessionAction(id)).toMatchObject({
    ok: true,
    analysisStatus: "running",
  })
  expect(readAuthority(id)?.hash).toBe(before)
  expect(await admitSessionAction(id)).toMatchObject({
    ok: true,
    analysisStatus: "running",
    stepState: { step: "result" },
  })
  expect((await getSession(id)).activeAnalysisId).toBe("analysis-1")
  expect(readAuthority(id)?.hash).toBe(before)
})

it("keeps confirmed cancellation visible until explicit recovery", async () => {
  const { id } = await admitted()
  const session = await getSession(id)
  Object.assign(session, {
    stage: "authenticated",
    rootStep: "result",
    activeAnalysisId: "analysis-1",
  })
  await session.save()
  setAnalysisOperation(id, "analysis-1", "running")
  setAnalysisOperation(id, "analysis-1", "cancelled")
  expect(await admitSessionAction(id)).toMatchObject({
    ok: true,
    analysisStatus: "cancelled",
    stepState: { step: "result" },
  })
})

it("observes another worker's invalidation through SQLite", async () => {
  const { id } = await admitted()
  const expected = readAuthority(id)?.hash
  const watch = watchAuthority(id, (current) => current.hash === expected)
  try {
    vi.resetModules()
    const independent = await import("@/lib/session-authority")
    independent.updateAuthority(id, (current) => ({
      ...current,
      hash: "revoked",
    }))
    await vi.waitFor(() => expect(watch.signal.aborted).toBe(true))
  } finally {
    watch.dispose()
  }
})

it("a failed stale save does not replace the newer browser snapshot", async () => {
  const { id } = await admitted()
  const first = await getSession(id)
  const second = await getSession(id)
  first.stage = "confirmation_sent"
  first.rootStep = "auth"
  await first.save()
  const cookies = [...jar]
  second.stage = "authenticated"
  second.rootStep = "document"
  await expect(second.save()).rejects.toThrow("stale_session_state")
  expect([...jar]).toEqual(cookies)
  expect((await getSession(id)).rootStep).toBe("auth")
  expect(updateAuthority(id, (current) => ({ ...current }))).toBe(true)
})

it("rejects historical terminal execution updates after replacement or reset", async () => {
  const { id } = await admitted()
  setAnalysisOperation(id, "old-analysis", "running")
  setAnalysisOperation(id, "new-analysis", "running")
  setAnalysisOperation(id, "old-analysis", "cancelled")
  expect(readAnalysisOperation(id, "new-analysis")).toBe("running")
  await revokeSession(id)
  setAnalysisOperation(id, "new-analysis", "completed")
  expect(readAnalysisOperation(id, "new-analysis")).toBeNull()
})

it("does not revoke a recent first admission whose browser cookie has not arrived", async () => {
  const { id } = await admitted()
  const cookies = [...jar]
  const before = readAuthority(id)
  jar.clear()
  expect(await admitSessionAction(id)).toMatchObject({
    ok: false,
    reason: "session_admission_pending",
  })
  expect(readAuthority(id)).toEqual(before)
  for (const [name, value] of cookies) jar.set(name, value)
  expect(await admitSessionAction(id)).toMatchObject({
    ok: true,
    scope: id,
    recovered: false,
  })
})

it("reads committed state with an unchanged credential before an action response arrives", async () => {
  const { id } = await admitted()
  const previousCookies = [...jar]
  const session = await getSession(id)
  session.stage = "confirmation_sent"
  session.rootStep = "auth"
  await session.save()
  const latestCookies = [...jar]
  const before = readAuthority(id)
  jar.clear()
  for (const [name, value] of previousCookies) jar.set(name, value)
  expect(await admitSessionAction(id)).toMatchObject({
    ok: true,
    stepState: { stage: "confirmation_sent", step: "auth" },
  })
  expect(readAuthority(id)).toEqual(before)
  jar.clear()
  for (const [name, value] of latestCookies) jar.set(name, value)
  expect(await admitSessionAction(id)).toMatchObject({
    ok: true,
    scope: id,
    recovered: false,
  })
})

it("requires a current server grant before replacing a stuck operation, preserving the credential", async () => {
  const auth = await import("@/features/auth/auth-service")
  const pending = vi.spyOn(auth, "hasPendingAdminRecovery")
  const { withAdminRecoveryOperation } = await import("./session-operation")
  const { id, token } = await admitted()
  const credential = [...jar.values()][0]
  updateAuthority(id, (record) => ({
    ...record,
    busy: "unverifiable-operation",
    withdrawing: 1,
  }))
  pending.mockResolvedValueOnce(false)
  expect(
    await withAdminRecoveryOperation(token, async () => ({ ok: true })),
  ).toMatchObject({ ok: false, reason: "recovery_not_authorized" })
  expect(readAuthority(id)?.busy).toBe("unverifiable-operation")
  pending.mockResolvedValueOnce(true)
  expect(
    await withAdminRecoveryOperation(token, async () => {
      const session = await getSession()
      session.rootStep = "consent"
      session.adminRecoveryPseudonym = "synthetic-pid"
      session.stage = "unauthenticated"
      await session.save()
      return { ok: true }
    }),
  ).toMatchObject({ ok: true })
  expect(readAuthority(id)).toMatchObject({ busy: null, withdrawing: 0 })
  expect([...jar.values()][0]).toBe(credential)
  expect(
    await withSessionOperation(token, "ordinary", async () => ({ ok: true })),
  ).toMatchObject({ ok: false, reason: "stale_session_state" })
  pending.mockRestore()
})

it.each(["missing", "wrong"])(
  "does not revoke another live generation with a %s cookie",
  async (cookie) => {
    const { id } = await admitted()
    const session = await getSession(id)
    session.stage = "authenticated"
    await session.save()
    setAnalysisOperation(id, "retained-analysis", "running")
    const originalCookies = [...jar]
    const before = readAuthority(id)
    jar.clear()
    if (cookie === "wrong")
      for (const [name] of originalCookies) jar.set(name, "wrong-cookie")
    const admittedOther = await admitSessionAction(id)
    expect(admittedOther).toMatchObject({ ok: true, recovered: true })
    if (admittedOther.ok !== true)
      throw new Error("Expected independent admission")
    expect(admittedOther.scope).not.toBe(id)
    expect(readAuthority(id)).toEqual(before)
    expect(readAnalysisOperation(id, "retained-analysis")).toBe("running")
    jar.clear()
    for (const [name, value] of originalCookies) jar.set(name, value)
    expect((await getSession(id)).stage).toBe("authenticated")
  },
)
