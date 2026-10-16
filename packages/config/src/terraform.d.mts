import type { Target } from "./targets.mjs"

export interface SupportTerraformInputs {
  environment: "test" | "production"
  project_id: string
  region: string
  monitoring?: { notification_email: string }
  firestore?: {
    location: string
    manage_existing_indexes?: boolean
    automatic_backups?: boolean
    backup_retention_days?: number
  }
}
export interface SupportFoundation {
  version: 1
  project: string
  region: string
  repository: string
  runtimeServiceAccount: string
  schedulerServiceAccount: string
  serviceEndpoint?: { name: string; projectNumber: string; baseUrl: string }
  gmailSecretIds: {
    clientSecret: "SUPPORT_GMAIL_CLIENT_SECRET"
    refreshToken: "SUPPORT_GMAIL_REFRESH_TOKEN"
  }
}
export function deriveSupportTerraformInputs(
  config: unknown,
  target: Target,
): SupportTerraformInputs
export function validateSupportFoundation(
  value: unknown,
  target: Target,
  region?: string,
): SupportFoundation
export function parseSupportTerraformOutputs(
  outputs: unknown,
  target: Target,
  region: string,
): SupportFoundation
