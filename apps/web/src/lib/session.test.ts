import { randomUUID } from "node:crypto"
import { getIronSession, unsealData } from "iron-session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { jar, setCookie } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  setCookie: vi.fn(),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
    set: setCookie,
    delete: (name: string) => jar.delete(name),
  }),
}))

const mockEnv = vi.hoisted(() => ({
  sessionCookieSecure: true,
  participantApiServerId: "synthetic-server",
  sessionSealPassword: process.env.SESSION_SEAL_PASSWORD as string,
  receptionExpiresAt: new Date("2027-01-01T00:00:00Z"),
}))
vi.mock("@aerpp/config/server/web", () => ({ env: mockEnv }))

import { getSession, getSessionOptions } from "./session"
import * as sessionAuthority from "./session-authority"
import { readAnalysisOperation, readAuthority } from "./session-authority"
import { openSessionDatabase } from "./session-database"

async function createStoredSession() {
  const response = new Response()
  const session = await getIronSession<{ stage: string }>(
    new Request("https://localhost/"),
    response,
    getSessionOptions(),
  )
  session.stage = "authenticated"
  await session.save()
  const setCookie = response.headers.get("set-cookie")
  if (!setCookie) {
    throw new Error("Expected a saved session cookie")
  }
  return { setCookie, cookie: setCookie.split(";")[0] }
}

async function restoreSession(cookie: string) {
  return await getIronSession<{ stage: string }>(
    new Request("https://localhost/", { headers: { cookie } }),
    new Response(),
    getSessionOptions(),
  )
}

describe("session expiration", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    mockEnv.receptionExpiresAt = new Date("2027-01-01T00:00:00Z")
    jar.clear()
    setCookie.mockReset().mockImplementation((name: string, value: string) => {
      jar.set(name, value)
    })
  })
  afterEach(() => vi.useRealTimers())

  it("keeps seals indefinite and persistent cookie retention independent of reception", () => {
    const options = getSessionOptions()
    expect(options.cookieName).toBe("aerpp-session")
    expect(options.cookieOptions?.secure).toBe(true)
    expect(options.cookieOptions?.maxAge).toBe(400 * 86400)
    expect(options.ttl).toBe(0)
    expect(options.cookieOptions?.expires).toBeUndefined()
  })

  it("restores the real sealed session after 15 days", async () => {
    const { cookie, setCookie } = await createStoredSession()
    expect(setCookie).toContain("Max-Age=34560000")
    vi.setSystemTime(new Date("2026-01-16T00:00:00Z"))
    expect((await restoreSession(cookie)).stage).toBe("authenticated")
  })

  it("retains the real sealed session beyond the former 90-day limit", async () => {
    const { cookie } = await createStoredSession()
    vi.setSystemTime(new Date("2026-04-02T00:00:00Z"))
    expect((await restoreSession(cookie)).stage).toBe("authenticated")
  })

  it("keeps browser retention independent of a shortened reception", async () => {
    mockEnv.receptionExpiresAt = new Date("2026-01-02T00:00:00Z")
    const { setCookie } = await createStoredSession()
    expect(setCookie).toContain("Max-Age=34560000")
    expect(setCookie).not.toContain("Expires=")
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"))
    expect(getSessionOptions().cookieOptions?.maxAge).toBe(400 * 86400)
  })

  it("restores a session after 15 days when the absolute expiration is later", async () => {
    mockEnv.receptionExpiresAt = new Date("2026-02-01T00:00:00Z")
    const { cookie } = await createStoredSession()
    vi.setSystemTime(new Date("2026-01-16T00:00:00Z"))
    expect((await restoreSession(cookie)).stage).toBe("authenticated")
  })

  it("restores encrypted browser data after reception closure", async () => {
    mockEnv.receptionExpiresAt = new Date("2026-01-02T00:00:00Z")
    const { cookie } = await createStoredSession()
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"))
    expect(getSessionOptions().ttl).toBe(0)
    expect((await restoreSession(cookie)).stage).toBe("authenticated")
  })

  it("creates indefinite authority and preserves its credential on ordinary saves", async () => {
    const started = Date.now()
    mockEnv.receptionExpiresAt = new Date(started + 60_000)
    const id = randomUUID()
    const session = await getSession(id)
    session.coordinationId = id
    vi.setSystemTime(started + 30_000)
    await session.save()
    expect(setCookie).toHaveBeenCalledOnce()
    expect(setCookie).toHaveBeenCalledWith(
      `aerpp-session-${id}`,
      expect.any(String),
      expect.objectContaining({
        maxAge: 400 * 86400,
      }),
    )
    expect(readAuthority(id)?.credentialHash).toEqual(expect.any(String))

    vi.setSystemTime(started + 50_000)
    const active = await getSession(id)
    active.stage = "authenticated"
    await active.save()
    expect(setCookie).toHaveBeenCalledOnce()
    expect(readAuthority(id)?.credentialHash).toEqual(expect.any(String))
  })

  it("reads retained credentials at reception closure while denying a pending mutation", async () => {
    const started = Date.now()
    mockEnv.receptionExpiresAt = new Date(started + 60_000)
    const options = getSessionOptions()
    const id = randomUUID()
    const session = await getSession(id)
    session.coordinationId = id
    await session.save()
    vi.setSystemTime(started + 59_000)
    const pending = await getSession(id)
    const cookie = [...jar.values()][0]

    vi.setSystemTime(started + 60_000)
    // Seal grace or delayed cookie delivery must not authorize participation.
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await unsealData(cookie, options)).toEqual({})
    expect((await getSession(id)).coordinationId).toBe(id)
    await expect(pending.save()).rejects.toThrow("Support reception has ended")
    expect(readAuthority(id)?.credentialHash).toBeTruthy()
    expect(setCookie).toHaveBeenCalledOnce()
  })

  it.each(
    [false, undefined, null, "false", 1, {}, []].map((saved) => ({ saved })),
  )(
    "does not acknowledge an unconfirmed authority update ($saved)",
    async ({ saved }) => {
      const id = randomUUID()
      const session = await getSession(id)
      session.coordinationId = id
      await session.save()
      const before = readAuthority(id)
      const update = vi
        .spyOn(sessionAuthority, "updateAuthority")
        .mockReturnValue(saved as boolean)
      try {
        session.stage = "authenticated"
        await expect(session.save()).rejects.toThrow("stale_session_state")
        expect(readAuthority(id)).toEqual(before)
        expect(setCookie).toHaveBeenCalledOnce()
      } finally {
        update.mockRestore()
      }
      // A rejected acknowledgement must not advance the handle's own CAS revision.
      await session.save()
      expect(JSON.parse(readAuthority(id)?.state ?? "{}").stage).toBe(
        "authenticated",
      )
    },
  )
  it.each(["sessions", "analysis_operations"])(
    "commits admission atomically when the %s write fails",
    async (table) => {
      const id = randomUUID()
      const analysisId = `aerpp:aid-${"a".repeat(32)}`
      const session = await getSession(id)
      session.coordinationId = id
      await session.save()
      const before = readAuthority(id)
      const db = openSessionDatabase()
      try {
        db.exec(
          `CREATE TRIGGER fail_admission BEFORE ${table === "sessions" ? "UPDATE" : "INSERT"} ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END`,
        )
        session.activeAnalysisId = analysisId
        await expect(
          session.save({ startAnalysisId: analysisId }),
        ).rejects.toThrow("synthetic storage failure")
        expect(readAuthority(id)).toEqual(before)
        expect(readAnalysisOperation(id, analysisId)).toBeNull()
        db.exec("DROP TRIGGER fail_admission")
        await session.save({ startAnalysisId: analysisId })
        expect(
          JSON.parse(readAuthority(id)?.state ?? "{}").activeAnalysisId,
        ).toBe(analysisId)
        expect(readAnalysisOperation(id, analysisId)).toBe("running")
      } finally {
        db.exec("DROP TRIGGER IF EXISTS fail_admission")
        db.close()
      }
    },
  )
})
