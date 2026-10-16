import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const originalEnv = { ...process.env }

function applyBaseEnv() {
  process.env.PARTICIPANT_API_SERVER_ID =
    originalEnv.PARTICIPANT_API_SERVER_ID ?? "test-server-id"
  process.env.IDENTIFIER_HASH_SECRET =
    originalEnv.IDENTIFIER_HASH_SECRET ?? "test-server-key"
  process.env.SESSION_SEAL_PASSWORD =
    originalEnv.SESSION_SEAL_PASSWORD ?? "test-server-keys-1-0123456789abcdef"
  process.env.AERPP_ENVIRONMENT = "test"
  process.env.SUPPORT_API_BASE_URL = "https://support.example.invalid"
  process.env.SUPPORT_API_CREDENTIAL = `synthetic.${"a".repeat(43)}`
  process.env.SUPPORT_RECEPTION_EXPIRES_AT = "2099-01-01T00:00:00Z"
  process.env.SUPPORT_CONTACT_EMAIL = "support@example.invalid"
  delete process.env.LLM_PRESET_FILE
  delete process.env.SESSION_COOKIE_SECURE
  delete process.env.DEBUG_PAGES_ENABLED
}

describe("env", () => {
  beforeEach(() => {
    vi.resetModules()
    applyBaseEnv()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("uses LM Studio defaults when optional values are absent", async () => {
    const { env } = await import("@aerpp/config/server/web")

    expect(env.debugPagesEnabled).toBe(true)
    expect(env.sendMagicLinkUrl).toBe(
      "https://support.example.invalid/api/participant/send-magic-link",
    )
  })

  it("requires a selected Support origin", async () => {
    delete process.env.SUPPORT_API_BASE_URL
    await expect(import("@aerpp/config/server/web")).rejects.toThrow(
      "SUPPORT_API_BASE_URL",
    )
  })

  it("derives fixed operation paths from the selected origin", async () => {
    process.env.SUPPORT_API_BASE_URL = "https://other.example.com"

    const { env } = await import("@aerpp/config/server/web")

    expect(env.sendMagicLinkUrl).toBe(
      "https://other.example.com/api/participant/send-magic-link",
    )
  })

  it("rejects short session passwords without exposing their value", async () => {
    process.env.SESSION_SEAL_PASSWORD = "short-private-key"
    await expect(import("@aerpp/config/server/web")).rejects.toThrow(
      "SESSION_SEAL_PASSWORD (expected: at least 32 characters)",
    )
  })

  it("allows overriding debug page availability", async () => {
    process.env.DEBUG_PAGES_ENABLED = "false"

    const { env } = await import("@aerpp/config/server/web")

    expect(env.debugPagesEnabled).toBe(false)
  })

  it("forces debug pages off in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.DEBUG_PAGES_ENABLED = "true"

    const { env } = await import("@aerpp/config/server/web")

    expect(env.debugPagesEnabled).toBe(false)
  })

  it("parses optional secure-access and absolute expiry settings", async () => {
    process.env.SESSION_COOKIE_SECURE = "TRUE"
    process.env.SUPPORT_RECEPTION_EXPIRES_AT = "2099-01-01T00:00:00.000Z"

    const { env } = await import("@aerpp/config/server/web")

    expect(env.sessionCookieSecure).toBe(true)
    expect(env.receptionExpiresAt?.toISOString()).toBe(
      "2099-01-01T00:00:00.000Z",
    )
  })

  it.each([undefined, "", "   ", "true", "TRUE"])(
    "keeps secure cookies enabled for %s",
    async (value) => {
      if (value !== undefined) process.env.SESSION_COOKIE_SECURE = value
      const { env } = await import("@aerpp/config/server/web")
      expect(env.sessionCookieSecure).toBe(true)
    },
  )

  it("disables secure cookies only for explicit false and rejects invalid values", async () => {
    process.env.SESSION_COOKIE_SECURE = "FALSE"
    expect(
      (await import("@aerpp/config/server/web")).env.sessionCookieSecure,
    ).toBe(false)
    vi.resetModules()
    process.env.SESSION_COOKIE_SECURE = "maybe"
    await expect(import("@aerpp/config/server/web")).rejects.toThrow(
      "SESSION_COOKIE_SECURE (expected: true or false)",
    )
  })

  it("exposes optional feature configuration without owning its default", async () => {
    process.env.LLM_PRESET_FILE = "lms-medgemma.json"

    const { readOptionalEnv } = await import("@aerpp/config/server/web")

    expect(readOptionalEnv("LLM_PRESET_FILE")).toBe("lms-medgemma.json")
  })

  it("rejects invalid session expiry but permits startup after an absolute cutoff", async () => {
    process.env.SUPPORT_RECEPTION_EXPIRES_AT = "not-a-date"
    await expect(import("@aerpp/config/server/web")).rejects.toThrow(
      "SUPPORT_RECEPTION_EXPIRES_AT (expected: ISO 8601 timestamp with timezone)",
    )

    vi.resetModules()
    applyBaseEnv()
    process.env.SUPPORT_RECEPTION_EXPIRES_AT = "2000-01-01T00:00:00.000Z"

    expect(
      (
        await import("@aerpp/config/server/web")
      ).env.receptionExpiresAt?.toISOString(),
    ).toBe("2000-01-01T00:00:00.000Z")
  })

  it("rejects unsupported debug-page overrides", async () => {
    process.env.DEBUG_PAGES_ENABLED = "maybe"

    await expect(import("@aerpp/config/server/web")).rejects.toThrow(
      "DEBUG_PAGES_ENABLED (expected: true or false)",
    )
  })

  it("rejects relative endpoint values", async () => {
    process.env.SUPPORT_API_BASE_URL = "/sendMagicLink"

    await expect(import("@aerpp/config/server/web")).rejects.toThrow(
      "SUPPORT_API_BASE_URL",
    )
  })
})
