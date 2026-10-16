import type { AdminDeployment } from "./admin-deployment.mjs"
import type { Target } from "./targets.mjs"
import type { SupportFoundation } from "./terraform.mjs"
export interface AutoSettings {
  version: 1
  _comment: string
  environment: string
  project: string
  projectNumber?: string
  updatedAt?: string
  deployment?: AdminDeployment
  serviceAccounts?: { admin: string; localAdmin?: string; logging: string }
  adminUrl?: string
  cloudStatus?: Record<string, string | number | boolean>
  terraform?: { support: SupportFoundation }
}
export const AUTO_COMMENT: string
export function readAutoSettings(
  directory: string,
  target: Pick<Target, "name" | "project">,
): AutoSettings
export function writeAutoSettings(
  directory: string,
  target: Pick<Target, "name" | "project">,
  patch: Partial<Omit<AutoSettings, "terraform">>,
): AutoSettings
export function writeSupportTerraformSettings(
  directory: string,
  target: Pick<Target, "name" | "project">,
  foundation: SupportFoundation,
): AutoSettings

export function autoSettingsFile(directory: string): string
export function validateAutoSettings(
  data: AutoSettings,
  target: Pick<Target, "name" | "project">,
): AutoSettings
