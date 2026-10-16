import type { Environment } from "./index.mjs"
export type EnvironmentName = "example" | "test" | "production"
export type Application =
  | "web"
  | "admin"
  | "functions"
  | "cloud"
  | "logging"
  | "support"
export const ENVIRONMENTS: Readonly<
  Record<
    EnvironmentName,
    {
      directory: string
      kind: "emulator" | "cloud"
      apps: readonly Application[]
    }
  >
>
export function environmentDefinition(
  name: string,
): (typeof ENVIRONMENTS)[EnvironmentName]
export function isPlaceholder(value: unknown): boolean
export function requireConfigured(
  env: Environment,
  keys: string[],
  app: string,
): void
export function assertEnvironmentSafety(env: Environment): void
