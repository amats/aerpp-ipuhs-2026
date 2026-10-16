import { spawn } from "node:child_process"
import { applicationEnvironment } from "@aerpp/config/process"

const emulator = process.env.FIRESTORE_EMULATOR_HOST
if (!/^127\.0\.0\.1:[0-9]+$/.test(emulator ?? ""))
  throw new Error("Isolated Firestore emulator required")
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3113",
  ],
  {
    env: {
      ...applicationEnvironment({
        FIRESTORE_EMULATOR_HOST: emulator,
        GCP_PROJECT_ID: "demo-admin-information",
        AERPP_ENVIRONMENT: "example",
        ADMIN_AUTH_BYPASS_ENABLED: "true",
        NEXTAUTH_URL: "http://127.0.0.1:3113",
        PARTICIPANT_API_SERVER_ID: "purpose-server",
        SUPPORT_RECEPTION_EXPIRES_AT: "2000-01-01T15:00:00Z",
        SUPPORT_BACKEND_STOPS_AT: "2099-12-31T00:00:00Z",
        NEXTAUTH_SECRET: "synthetic-information-browser-secret",
        SESSION_SEAL_PASSWORD: "synthetic-information-email-seal-password",
        IDENTIFIER_HASH_SECRET: "synthetic-information-identifier-secret",
      }),
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      METADATA_SERVER_DETECTION: "none",
    },
    stdio: "inherit",
  },
)
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal))
child.on("error", () => {
  console.error("Cannot start isolated Admin test server")
  process.exitCode = 1
})
child.on("exit", (code) => {
  process.exitCode = code ?? 1
})
