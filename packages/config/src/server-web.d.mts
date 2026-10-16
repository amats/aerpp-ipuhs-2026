import type { readWebEnvironment } from "./web.mjs"

export const env: ReturnType<typeof readWebEnvironment>
export function readOptionalEnv(key: string): string | undefined
