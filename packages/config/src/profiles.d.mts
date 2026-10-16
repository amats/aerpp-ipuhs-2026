import type { SecretReference } from "./secrets.mjs"
import type { SupportProfile } from "./support-profile.mjs"
export type ProfileSection = "shared" | "web" | "admin" | "logging"
export type ProfileValues = Record<string, string | SecretReference>
export type ProfileConfig = Partial<Record<ProfileSection, ProfileValues>> & {
  version: 1
  support?: SupportProfile
  shared: ProfileValues
  secretProvider: { type: "file"; path: string } | { type: "environment" }
}
export const ENVIRONMENT_SECTION_KEYS: Readonly<
  Record<ProfileSection, readonly string[]>
>
export function deriveApplicationEnvironments<
  App extends Exclude<ProfileSection, "shared"> = Exclude<
    ProfileSection,
    "shared"
  >,
>(
  config: ProfileConfig,
  target: {
    project: string
    name: string
  },
  selectedApps?: App[],
): Record<App, ProfileValues>

export const APPLICATION_ENVIRONMENT_KEYS: readonly string[]
