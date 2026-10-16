import { applicationEnvironment } from "@aerpp/config/process"

export function adminBuildEnvironment(environment) {
  if (!["local", "test", "production"].includes(environment))
    throw new Error("Select an Admin build environment")
  return {
    ...applicationEnvironment({
      AERPP_ENVIRONMENT: environment === "local" ? "" : environment,
      NEXTAUTH_URL: "https://admin.example.invalid",
      PARTICIPANT_API_SERVER_ID: "synthetic-build-server",
      SUPPORT_RECEPTION_EXPIRES_AT: "2099-01-01T00:00:00Z",
      SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
      NEXTAUTH_SECRET: "synthetic-build-session-secret",
      SESSION_SEAL_PASSWORD: "synthetic-build-email-seal-password",
      IDENTIFIER_HASH_SECRET: "synthetic-build-identifier-secret",
      ADMIN_GOOGLE_OAUTH_CLIENT_ID:
        "synthetic-build.apps.googleusercontent.com",
      ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-build-client-secret",
      ADMIN_ALLOWED_EMAILS: "admin@example.invalid",
      GCP_PROJECT_ID: "synthetic-admin-build",
    }),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  }
}
