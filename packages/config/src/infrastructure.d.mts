import type { Target } from "./targets.mjs"

export interface AdminDeployment {
  version: 1
  region: string
  service: string
  repository: string
  serviceAccountId: string
  maxInstances: number
}
export function parseAdminDeployment(value: unknown): AdminDeployment
export function deriveInfrastructure(
  config: { infrastructure?: Record<string, unknown> },
  target: Pick<Target, "name" | "project">,
  directory?: string,
): {
  deployment: AdminDeployment
  serviceAccounts: { admin: string; localAdmin: string; logging: string }
}
