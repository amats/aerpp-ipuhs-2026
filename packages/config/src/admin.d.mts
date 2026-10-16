import type { Environment } from "./index.mjs"

export function readAdminEnvironment(source: Environment): {
  readonly nodeEnv: string
  readonly environment: string
  readonly adminAuthBypassEnabled: boolean
  readonly localGoogleAccount: string | undefined
  readonly localServiceAccount: string | undefined
  readonly gcloudConfigDirectory: string | undefined
  readonly nextAuthSessionSecret: string | undefined
  readonly adminGoogleOAuthClientId: string | undefined
  readonly adminGoogleOAuthClientSecret: string | undefined
  readonly adminAllowedEmails: string[]
  readonly gcpProjectId: string
  readonly participantApiServerId: string
  readonly supportReceptionExpiresAt: Date
  readonly supportBackendStopsAt: Date
  readonly sessionSealPassword: string
  readonly identifierHashSecret: string
}
