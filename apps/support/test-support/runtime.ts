import { createHash } from "node:crypto"
import type { Runtime } from "@aerpp/config/support"
import { SUPPORT_ROUTES } from "@aerpp/config/support-routes"
export const CALLER_SECRET =
  "synthetic-local-caller-secret-000000000000000000000"
export function syntheticRuntime(): Runtime {
  return {
    testEmailAddresses: [],
    environment: "local",
    projectId: "demo-support",
    baseUrl: "http://127.0.0.1:8080",
    admissionOpen: true,
    maintenanceEnabled: true,
    credentials: [
      {
        id: "local",
        verifierHash: createHash("sha256").update(CALLER_SECRET).digest("hex"),
        serverId: "server-1",
        environment: "local",
        operations: Object.keys(SUPPORT_ROUTES).filter(
          (name) => name !== "magicCompletePage",
        ),
        notBeforeMs: 0,
        expiresAtMs: 253402300799999,
        revoked: false,
      },
    ],
    tokenKey: "synthetic-local-token-secret-0000000000000000000000",
    schedulerIdentity: "scheduler@synthetic.example.invalid",
    contactEmail: "contact@example.invalid",
    mailMode: "sink",
  }
}
