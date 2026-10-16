import type { Target } from "./targets.mjs"
export const SERVICE_CREDENTIAL_KEYS: Readonly<Record<string, string>>
export function parseServiceCredential(
  value: unknown,
  project: string,
  app: string,
): {
  type: "service_account"
  project_id: string
  client_email: string
  [key: string]: unknown
}
export function storedServiceIdentity(
  directory: string,
  target: Target,
  app: string,
): string | undefined
export function materializeServiceCredential(
  directory: string,
  target: Target,
  app: string,
  value: unknown,
): string
