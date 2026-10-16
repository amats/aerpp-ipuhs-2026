import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  logAuthenticationFailure: vi.fn(),
  logAuthenticationWarning: vi.fn(),
  env: {
    adminAllowedEmails: ["admin@example.com"],
    adminAuthBypassEnabled: false,
    nextAuthSessionSecret: "synthetic-secret",
    adminGoogleOAuthClientId: "synthetic-client",
    adminGoogleOAuthClientSecret: "synthetic-secret",
  },
}))
vi.mock("@aerpp/config/server/admin", () => ({ env: mocks.env }))
vi.mock("@/lib/logger", () => ({
  logAuthenticationFailure: mocks.logAuthenticationFailure,
  logAuthenticationWarning: mocks.logAuthenticationWarning,
}))
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getServerSession.mockReset()
  mocks.env.adminAllowedEmails = ["admin@example.com"]
  mocks.env.adminAuthBypassEnabled = false
})

describe("admin sign-in", () => {
  it.each([
    ["ADMIN@example.com", "google", true, true],
    ["other@example.com", "google", true, false],
    ["admin@example.com", "google", false, false],
    ["admin@example.com", "google", undefined, false],
    ["admin@example.com", "google", "true", false],
    ["admin@example.com", "other", true, false],
    [undefined, "google", true, false],
  ])(
    "checks email %s, provider %s and verification %s",
    async (email, provider, verified, expected) => {
      const { authOptions } = await import("./auth")
      const signIn = authOptions.callbacks?.signIn
      if (!signIn) throw new Error("Missing sign-in callback")
      expect(
        await signIn({
          user: { id: "synthetic-user", email },
          account: {
            provider,
            type: "oauth",
            providerAccountId: "synthetic-user",
          },
          profile: { email_verified: verified } as Parameters<
            typeof signIn
          >[0]["profile"],
        }),
      ).toBe(expected)
    },
  )
})

describe("existing admin sessions", () => {
  const session: Session = {
    user: { email: "admin@example.com" },
    expires: "2099-01-01T00:00:00Z",
  }
  it("rejects the same session after the updated allowlist is loaded", async () => {
    mocks.getServerSession.mockResolvedValue(session)
    expect(await (await import("./auth")).requireAdminSession()).toEqual(
      session,
    )
    mocks.env.adminAllowedEmails = []
    vi.resetModules()
    await expect(
      (await import("./auth")).requireAdminSession("/survey?x=1"),
    ).rejects.toThrow("redirect:/api/auth/signin?callbackUrl=%2Fsurvey%3Fx%3D1")
  })
  it.each([null, { user: {} }, { user: { email: "other@example.com" } }])(
    "rejects absent or unauthorized identity %j",
    async (value) => {
      mocks.getServerSession.mockResolvedValue(value)
      await expect(
        (await import("./auth")).requireAdminSession(),
      ).rejects.toThrow("redirect:")
    },
  )
  it("preserves the development bypass", async () => {
    mocks.env.adminAuthBypassEnabled = true
    const { requireAdminSession, authOptions } = await import("./auth")
    expect((await requireAdminSession()).user?.email).toBe(
      "local-auth-bypass@example.com",
    )
    expect(authOptions.providers).toEqual([])
    expect(mocks.getServerSession).not.toHaveBeenCalled()
  })
  it.each([false, undefined, null, "false", "true", 1, {}, []])(
    "does not bypass authentication for an unconfirmed flag %j",
    async (flag) => {
      Object.assign(mocks.env, { adminAuthBypassEnabled: flag })
      const { requireAdminSession, authOptions } = await import("./auth")
      expect(authOptions.providers).toHaveLength(1)
      expect(authOptions.callbacks?.signIn).toBeTypeOf("function")
      await expect(requireAdminSession()).rejects.toThrow("redirect:")
      expect(mocks.getServerSession).toHaveBeenCalledOnce()
    },
  )
})

it("excludes OAuth errors, tokens and session metadata from authentication diagnostics", async () => {
  const { authOptions } = await import("./auth")
  authOptions.logger?.error?.("private-code", {
    error: new Error("private-token"),
    email: "private@example.invalid",
  })
  authOptions.logger?.warn?.("DEBUG_ENABLED")
  authOptions.logger?.debug?.("private-debug", { session: "private-session" })
  expect(mocks.logAuthenticationFailure).toHaveBeenCalledWith()
  expect(mocks.logAuthenticationWarning).toHaveBeenCalledWith()
  expect(
    JSON.stringify([
      mocks.logAuthenticationFailure.mock.calls,
      mocks.logAuthenticationWarning.mock.calls,
    ]),
  ).not.toContain("private")
})
