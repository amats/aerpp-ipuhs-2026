import type { AdminDeployment } from "./infrastructure.mjs"
export function readAdminDeployment(
  environment: string,
  directory?: string,
): AdminDeployment
export function adminServiceUrl(
  deployment: AdminDeployment,
  projectNumber: string,
): string
export function hostedAdminEnvironment(
  settings: Record<string, string>,
  url: string,
  environment: string,
): { runtime: Record<string, string>; secrets: Record<string, string> }
