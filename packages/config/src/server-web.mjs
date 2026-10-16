import "server-only"
import { readOptionalEnvironment } from "./index.mjs"
import { readWebEnvironment } from "./web.mjs"

export const env = readWebEnvironment(process.env)

export function readOptionalEnv(key) {
  return readOptionalEnvironment(process.env, key)
}
