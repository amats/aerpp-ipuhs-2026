import { createHash } from "node:crypto"

// Hash exact projected values without persisting or printing secret contents.
export function runtimeFingerprint(settings) {
  if (
    settings === null ||
    typeof settings !== "object" ||
    Array.isArray(settings) === true ||
    Object.values(settings).some((value) => typeof value !== "string") === true
  )
    throw new Error("Runtime fingerprint requires projected string settings")
  const entries = Object.keys(settings)
    .sort()
    .map((key) => [key, settings[key]])
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex")
}
