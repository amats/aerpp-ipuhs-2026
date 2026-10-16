import type { Environment } from "./index.mjs"
export function validateWebEnvironment(
  source: Environment,
  options?: { checkLlm?: boolean; webDirectory?: string },
): string[]
