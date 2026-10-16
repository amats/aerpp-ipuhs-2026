import type { Environment } from "./index.mjs"
export type SecretReference = { secret: string }
export interface SecretProvider {
  getSecret(name: string): string
}
export function createEnvironmentSecretProvider(
  env: Environment,
): SecretProvider
export interface FileSecretProvider extends SecretProvider {
  getJsonSecret(name: string): Record<string, unknown>
}
export function createFileSecretProvider(file: string | URL): FileSecretProvider
export function resolveSecretReferences(
  values: Record<string, string | SecretReference>,
  provider: SecretProvider,
): Record<string, string>
