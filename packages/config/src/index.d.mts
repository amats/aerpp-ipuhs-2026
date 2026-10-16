export type Environment = Record<string, string | undefined>
export function readOptionalEnvironment(
  env: Environment,
  key: string,
): string | undefined
export function readRequiredEnvironment(env: Environment, key: string): string
export function resolveGcpProjectId(env: Environment): string | undefined
export function resolveParticipantApiUrl(value: string): string
