import type { AccessProfile } from "./access-profile.mjs"
import type { AutoSettings } from "./auto-settings.mjs"
import type { Environment } from "./index.mjs"
import type { SecretProvider, SecretReference } from "./secrets.mjs"
import type { Target } from "./targets.mjs"

export interface SupportProfile {
  admissionOpen: boolean
  maintenanceEnabled: boolean
  contactEmail: string
  tokenKey: SecretReference
  access: AccessProfile
  local?: { baseUrl: string; firestoreEmulatorHost: string }
  gmail?: {
    clientId: string
    clientSecret: SecretReference
    refreshToken: SecretReference
    sender: string
  }
}
export function projectSupportEnvironment(
  profile: unknown,
  target: Target,
  automatic: Partial<AutoSettings>,
  provider: SecretProvider,
  infrastructure: { region?: string } | undefined,
  serverId: string,
  participantEmailPattern?: string,
  testEmailAddresses?: string[],
): Environment
