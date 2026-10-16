import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv("NODE_ENV", "test")
  vi.stubEnv("GCP_PROJECT_ID", "synthetic-test")
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "")
  vi.stubEnv("GCLOUD_PROJECT", "")
  vi.stubEnv("PARTICIPANT_API_SERVER_ID", "synthetic-server")
  vi.stubEnv("SUPPORT_RECEPTION_EXPIRES_AT", "2099-01-01T00:00:00Z")
  vi.stubEnv("SUPPORT_BACKEND_STOPS_AT", "2099-12-31T00:00:00Z")
  vi.stubEnv("NEXTAUTH_SECRET", "  synthetic-secret  ")
  vi.stubEnv("IDENTIFIER_HASH_SECRET", "  synthetic-identifier-secret  ")
  vi.stubEnv("SESSION_SEAL_PASSWORD", "synthetic-runtime-email-seal-password")
  vi.stubEnv("ADMIN_GOOGLE_OAUTH_CLIENT_ID", "synthetic-client")
  vi.stubEnv("ADMIN_GOOGLE_OAUTH_CLIENT_SECRET", "synthetic-client-secret")
  vi.stubEnv("ADMIN_AUTH_BYPASS_ENABLED", "false")
})
afterEach(() => vi.unstubAllEnvs())

describe("shared admin configuration names", () => {
  it("uses the shared project/server names and preserves secret bytes", async () => {
    const { env } = await import("@aerpp/config/server/admin")
    expect(env.gcpProjectId).toBe("synthetic-test")
    expect(env.participantApiServerId).toBe("synthetic-server")
    expect(env.nextAuthSessionSecret).toBe("  synthetic-secret  ")
    expect(env.identifierHashSecret).toBe("  synthetic-identifier-secret  ")
  })
  it("rejects conflicting Google runtime projects", async () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "synthetic-production")
    await expect(import("@aerpp/config/server/admin")).rejects.toThrow(
      "Conflicting GCP project",
    )
  })
  it("reads the admin allowlist and selected keyless Google identity", async () => {
    vi.stubEnv(
      "ADMIN_ALLOWED_EMAILS",
      " First@example.com,SECOND@example.com, ",
    )
    vi.stubEnv("ADMIN_GCLOUD_ACCOUNT", "operator@example.invalid")
    vi.stubEnv(
      "ADMIN_LOCAL_SERVICE_ACCOUNT",
      "aerpp-admin-local@synthetic-test.iam.gserviceaccount.com",
    )
    const { env } = await import("@aerpp/config/server/admin")
    expect(env.adminAllowedEmails).toEqual([
      "first@example.com",
      "second@example.com",
    ])
    expect(env.localGoogleAccount).toBe("operator@example.invalid")
    expect(env.localServiceAccount).toBe(
      "aerpp-admin-local@synthetic-test.iam.gserviceaccount.com",
    )
    expect(env.adminGoogleOAuthClientId).toBe("synthetic-client")
    expect(env.adminGoogleOAuthClientSecret).toBe("synthetic-client-secret")
  })
  it("allows the authentication bypass only for explicit development with a local example emulator", async () => {
    vi.stubEnv("ADMIN_AUTH_BYPASS_ENABLED", "true")
    vi.stubEnv("NODE_ENV", "development")
    await expect(import("@aerpp/config/server/admin")).rejects.toThrow(
      "Admin authentication bypass requires",
    )
    vi.resetModules()
    vi.stubEnv("AERPP_ENVIRONMENT", "example")
    vi.stubEnv("GCP_PROJECT_ID", "demo-admin")
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8088")
    vi.stubEnv("NEXTAUTH_SECRET", "")
    vi.stubEnv("ADMIN_GOOGLE_OAUTH_CLIENT_ID", "")
    vi.stubEnv("ADMIN_GOOGLE_OAUTH_CLIENT_SECRET", "")
    expect(
      (await import("@aerpp/config/server/admin")).env.adminAuthBypassEnabled,
    ).toBe(true)
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    await expect(import("@aerpp/config/server/admin")).rejects.toThrow(
      "NEXTAUTH_SECRET",
    )
  })
})
