import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import type { NextFetchEvent } from "next/server"
import { NextRequest } from "next/server"
import { encode } from "next-auth/jwt"
import type { NextRequestWithAuth } from "next-auth/middleware"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const mocks = vi.hoisted(() => ({
  env: {
    adminAllowedEmails: ["admin@example.com"],
    adminAuthBypassEnabled: false,
  },
}))
vi.mock("@aerpp/config/server/admin", () => mocks)
const SECRET = "synthetic-session-secret"

beforeEach(() => {
  vi.resetModules()
  mocks.env.adminAllowedEmails = ["admin@example.com"]
  mocks.env.adminAuthBypassEnabled = false
  vi.stubEnv("NEXTAUTH_SECRET", SECRET)
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3001")
})
afterEach(() => vi.unstubAllEnvs())

async function request(path: string, token?: string) {
  const { proxy } = await import("./proxy")
  return proxy(
    new NextRequest(`http://localhost:3001${path}`, {
      headers: token ? { cookie: `next-auth.session-token=${token}` } : {},
    }) as NextRequestWithAuth,
    {} as NextFetchEvent,
  )
}

it("denies an existing signed cookie after allowlist removal", async () => {
  const token = await encode({
    secret: SECRET,
    token: { email: "ADMIN@example.com" },
  })
  expect(await request("/dashboard", token)).toBeUndefined()
  mocks.env.adminAllowedEmails = []
  vi.resetModules()
  expect(
    (await request("/dashboard", token))?.headers.get("location"),
  ).toContain("/api/auth/signin?")
})
it("denies missing or tampered cookies but permits auth routes", async () => {
  expect((await request("/survey"))?.status).toBe(307)
  expect((await request("/survey", "invalid"))?.status).toBe(307)
  expect(await request("/api/auth/signin")).toBeUndefined()
  expect(await request("/api/auth/callback/google")).toBeUndefined()
})
it("preserves the development bypass", async () => {
  mocks.env.adminAuthBypassEnabled = true
  expect((await request("/dashboard"))?.headers.get("x-middleware-next")).toBe(
    "1",
  )
})
it.each([false, undefined, null, "false", "true", 1, {}, []])(
  "does not bypass the request guard for an unconfirmed flag %j",
  async (flag) => {
    Object.assign(mocks.env, { adminAuthBypassEnabled: flag })
    expect((await request("/dashboard"))?.status).toBe(307)
  },
)

it.each([
  "/manifest.json",
  "/robots.txt",
  "/icon.svg?icon=revision",
  "/apple-icon.png?icon=revision",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
])(
  "serves the public metadata asset %s without authentication",
  async (url) => {
    const { config } = await import("./proxy")
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
      false,
    )
  },
)

it.each([
  "/",
  "/dashboard",
  "/research",
  "/api/research/export?dataset=access&format=bundle",
  "/private.png",
  "/iconXsvg",
  "/manifest.json/private",
  "/android-chrome-512x512.png/private",
  "/android-chrome-192x192.png.json",
])("keeps authentication on %s", async (url) => {
  const { config } = await import("./proxy")
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(
    true,
  )
})
