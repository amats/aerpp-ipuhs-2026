import { readFileSync } from "node:fs"
import { readRequiredEnvironment } from "./index.mjs"

// Providers run in server/tooling processes only. No cloud calls occur here.
export function createEnvironmentSecretProvider(env) {
  return { getSecret: (name) => readRequiredEnvironment(env, name) }
}

export function createFileSecretProvider(file) {
  let values
  try {
    values = JSON.parse(readFileSync(file, "utf8"))
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error()
  } catch {
    throw new Error("Cannot read the private secret store")
  }
  return {
    ...createEnvironmentSecretProvider(values),
    getJsonSecret(name) {
      const value = values[name]
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Secret ${name} must be a JSON object`)
      return value
    },
  }
}

export function resolveSecretReferences(values, provider) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (typeof value === "string") return [key, value]
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        typeof value.secret === "string" &&
        /^[A-Z][A-Z0-9_]*$/.test(value.secret)
      ) {
        return [key, provider.getSecret(value.secret)]
      }
      throw new Error(`Invalid configuration value for ${key}`)
    }),
  )
}
