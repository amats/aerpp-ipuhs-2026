import { ParticipantRecordOwnerSchema } from "@aerpp/participant-api-contracts/participant-api"
import { throwApiError } from "./api-errors.js"

export function parseRecordOwner(data: unknown) {
  const result = ParticipantRecordOwnerSchema.safeParse(data)
  if (!result.success)
    return throwApiError(409, "OWNER_INVALID", "invalid record owner")
  return result.data
}
export function assertMatchingSurveyOwner(
  existing: unknown,
  incoming: unknown,
) {
  if (
    serializeCanonicalJson(parseRecordOwner(existing)) !==
      serializeCanonicalJson(parseRecordOwner(incoming)) ||
    (existing as Record<string, unknown>).consentId !==
      (incoming as Record<string, unknown>).consentId
  )
    throwApiError(409, "OWNER_CONFLICT", "survey owner conflicts")
}
export function serializeCanonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(serializeCanonicalJson).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`
  return JSON.stringify(value)
}
export function extractSurveyPayload(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(body).filter(
      ([key]) =>
        ![
          "analysisId",
          "serverId",
          "clientId",
          "pseudonym",
          "consentId",
        ].includes(key),
    ),
  )
}
