import { z } from "zod"
import { ENVIRONMENT_SECTION_KEYS } from "./profiles.mjs"

const names = Object.fromEntries(
  [...new Set(Object.values(ENVIRONMENT_SECTION_KEYS).flat())].map((key) => [
    key,
    key
      .toLowerCase()
      .replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase())
      .replace(/^nextauth/, "nextAuth"),
  ]),
)

const runtimeNames = Object.fromEntries(
  Object.entries(names).map(([runtime, manual]) => [manual, runtime]),
)

function convertConfig(config, direction) {
  const result = structuredClone(config)
  if (result.participants !== undefined) {
    const parsed = z
      .object({
        testEmailAddresses: z.array(z.string().trim().toLowerCase().email()),
      })
      .strict()
      .safeParse(result.participants)
    if (!parsed.success)
      throw new Error("Invalid participants.testEmailAddresses in config.json")
    result.participants = {
      testEmailAddresses: [...new Set(parsed.data.testEmailAddresses)],
    }
  }
  if (direction === "runtime") {
    if (
      ["webAccess", "backendStopsAt"].some((key) =>
        Object.hasOwn(result?.support ?? {}, key),
      )
    )
      throw new Error(
        "config.json: move support.webAccess and support.backendStopsAt to support.access",
      )
    for (const [section, keys] of Object.entries({
      shared: ["participantApiEndpointsFile"],
      web: ["receptionExpiresAt", "supportContactEmail"],
      support: ["credentials", "tokenKeyId"],
      admin: [
        "nextAuthUrl",
        "adminCloudSettingsFile",
        "supportReceptionExpiresAt",
        "supportBackendStopsAt",
      ],
    }))
      for (const key of keys)
        if (Object.hasOwn(result?.[section] ?? {}, key))
          throw new Error(
            `config.json: ${section}.${key} is generated; remove generated settings from config.json`,
          )
    if (Object.hasOwn(result?.infrastructure ?? {}, "projectId"))
      throw new Error(
        "config.json: move infrastructure.projectId to top-level projectId",
      )
    if (Object.hasOwn(result ?? {}, "secretProvider"))
      throw new Error(
        "config.json: secretProvider is fixed to secret.json; remove generated settings from config.json",
      )
  }
  for (const section of Object.keys(ENVIRONMENT_SECTION_KEYS)) {
    const values = result?.[section]
    if (!values || typeof values !== "object" || Array.isArray(values)) continue
    const converted = {}
    for (const [key, value] of Object.entries(values)) {
      if (direction === "runtime" && names[key])
        throw new Error(
          `config.json: use ${section}.${names[key]} instead of ${section}.${key}`,
        )
      const name =
        (direction === "profile" ? names[key] : runtimeNames[key]) ?? key
      if (Object.hasOwn(converted, name))
        throw new Error(`config.json: duplicate setting in ${section}: ${name}`)
      converted[name] = value
    }
    result[section] = converted
  }
  return result
}

// Manual settings use lowerCamelCase; runtime exports use canonical environment names.
export function decodeManualConfig(config) {
  return convertConfig(config, "runtime")
}

export function encodeManualConfig(config) {
  return convertConfig(config, "profile")
}
