import type { z } from "zod"
export interface Credential {
  id: string
  verifierHash: string
  serverId: string
  environment: "local" | "test" | "production"
  operations: string[]
  notBeforeMs: number
  expiresAtMs: number
  revoked: boolean
}
export const CredentialSchema: z.ZodType<Credential>
export interface Runtime {
  testEmailAddresses: string[]
  environment: "local" | "test" | "production"
  projectId: string
  baseUrl: string
  admissionOpen: boolean
  maintenanceEnabled: boolean
  credentials: Credential[]
  tokenKey: string
  schedulerIdentity: string
  contactEmail: string
  mailMode: "sink" | "gmail"
  gmail?: {
    clientId: string
    clientSecret: string
    refreshToken: string
    sender: string
    participantEmailPattern: string
  }
}
export function readSupportEnvironment(
  env: Record<string, string | undefined>,
): Runtime

export function participantEmailRegexp(pattern: string): RegExp
export function supportMaintenanceWindowActive(
  runtime: Pick<Runtime, "environment" | "credentials">,
  now?: number,
): boolean
