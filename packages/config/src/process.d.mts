import type { Environment } from "./index.mjs"
export function applicationEnvironment(
  settings: Environment,
  inherited?: Environment,
): Environment
export function assertNoAppEnvFiles(directory: string): void
