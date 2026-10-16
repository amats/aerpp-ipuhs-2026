import { randomUUID } from "node:crypto"
import { cookies } from "next/headers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getSession } from "@/lib/session"
import { readAuthority } from "@/lib/session-authority"
import { resetSessionAction } from "./actions-reset"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@aerpp/config/server/web", () => ({
  env: {
    nodeEnv: "test",
    debugPagesEnabled: true,
    participantApiServerId: "synthetic-server",
    logLevel: "silent",
    sessionCookieSecure: true,
    sessionSealPassword: process.env.SESSION_SEAL_PASSWORD as string,
    receptionExpiresAt: new Date("2026-01-02T00:00:00Z"),
  },
}))

describe("reset after expiration", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())
  it.each([0, 180_000])(
    "clears cookies %i ms after the cutoff and rejects an earlier pending save",
    async (elapsed) => {
      const jar = new Map<string, string>()
      vi.mocked(cookies).mockResolvedValue({
        get: (name: string) => {
          const value = jar.get(name)
          return value === undefined ? undefined : { name, value }
        },
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        set: (name: string, value: string) => {
          jar.set(name, value)
        },
        delete: (name: string) => {
          jar.delete(name)
        },
      } as unknown as Awaited<ReturnType<typeof cookies>>)
      const session = await getSession()
      const id = randomUUID()
      session.coordinationId = id
      await session.save()
      session.stage = "authenticated"
      await session.save()
      const pending = await getSession()
      jar.set("synthetic-preference", "true")
      vi.setSystemTime(new Date("2026-01-02T00:00:00Z").getTime() + elapsed)
      expect((await getSession()).stage).toBe("authenticated")
      await expect(resetSessionAction(id, randomUUID())).resolves.toEqual({
        ok: true,
      })
      expect([...jar]).toEqual([])
      expect(readAuthority(id)?.busy).toBeNull()
      pending.stage = "authenticated"
      await expect(pending.save()).rejects.toThrow(
        "Support reception has ended",
      )
      expect([...jar]).toEqual([])
      expect((await getSession()).authVerifiedAt).toBeUndefined()
    },
  )
})
