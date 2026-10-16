import { createHash } from "node:crypto"
import { z } from "zod"
import { readAccessProfile } from "./access-profile.mjs"
import { readSupportEnvironment } from "./support.mjs"
import { validateSupportFoundation } from "./terraform.mjs"

// Web callers never receive operator-only operations such as addInformation.
const WEB_OPERATIONS = Object.freeze([
  "readDocumentOriginal",
  "sendMagicLink",
  "verifyAuthentication",
  "withdrawParticipation",
  "listParticipationEvents",
  "getParticipationState",
  "recordAnalysisAttempt",
  "recordAnalysisOutcome",
  "recordAnalysisCompletion",
  "submitSurvey",
  "getInformation",
])

const secretReference = z
  .object({ secret: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })
  .strict()
const profileSchema = z
  .object({
    admissionOpen: z.boolean(),
    maintenanceEnabled: z.boolean(),
    contactEmail: z.string().email(),
    tokenKey: secretReference,
    access: z.unknown(),
    local: z
      .object({
        baseUrl: z.string(),
        firestoreEmulatorHost: z.string(),
      })
      .strict()
      .optional(),
    gmail: z
      .object({
        clientId: z
          .string()
          .regex(/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/),
        clientSecret: secretReference,
        refreshToken: secretReference,
        sender: z.string().email(),
      })
      .strict()
      .optional(),
  })
  .strict()

export function projectSupportEnvironment(
  profile,
  target,
  automatic,
  provider,
  infrastructure,
  serverId,
  participantEmailPattern,
  testEmailAddresses = [],
) {
  if (!["example", "test", "production"].includes(target.name))
    throw new Error(
      "Support profiles are available for example, test and production",
    )
  const parsed = profileSchema.safeParse(profile)
  if (!parsed.success)
    throw new Error(
      `Configure support profile fields: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "support"))].join(", ")}`,
    )
  const input = parsed.data
  const access = readAccessProfile(input.access)
  const local = target.name === "example"
  if (local ? !input.local || input.gmail : input.local || !input.gmail)
    throw new Error(
      "Example support requires local settings; cloud support requires Gmail and no local overrides",
    )
  let baseUrl
  let schedulerIdentity
  if (local) {
    baseUrl = input.local.baseUrl
    schedulerIdentity = "scheduler@example.invalid"
  } else {
    const foundation = validateSupportFoundation(
      automatic?.terraform?.support,
      target,
      infrastructure?.region,
    )
    if (!infrastructure?.region || !foundation.serviceEndpoint)
      throw new Error(
        "Apply current support Terraform outputs before projecting cloud support settings",
      )
    if (
      automatic.projectNumber &&
      automatic.projectNumber !== foundation.serviceEndpoint.projectNumber
    )
      throw new Error(
        "Support Terraform project number conflicts with discovered project metadata",
      )
    baseUrl = foundation.serviceEndpoint.baseUrl
    schedulerIdentity = foundation.schedulerServiceAccount
  }
  const secret = (reference) => {
    const value = provider.getSecret(reference.secret)
    if (!value || /^(YOUR_|replace[-_ ]with)/i.test(value.trim()))
      throw new Error("Configure the referenced support secret in secret.json")
    return value
  }
  const caller = secret({ secret: "SUPPORT_WEB_API_CREDENTIAL" })
  const match = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{43,128})$/.exec(caller)
  if (
    !match ||
    typeof serverId !== "string" ||
    !serverId.trim() ||
    /^(YOUR_|replace[-_ ]with)/i.test(serverId)
  )
    throw new Error(
      "Configure SUPPORT_WEB_API_CREDENTIAL and shared.participantApiServerId",
    )
  const environment = local ? "local" : target.name
  const runtime = {
    environment,
    testEmailAddresses,
    projectId: target.project,
    baseUrl,
    admissionOpen: input.admissionOpen,
    maintenanceEnabled: input.maintenanceEnabled,
    contactEmail: input.contactEmail,
    tokenKey: secret(input.tokenKey),
    credentials: [
      {
        notBeforeMs: Date.parse(access.notBefore),
        expiresAtMs: Date.parse(access.backendStopsAt),
        revoked: access.revoked,
        operations: [...WEB_OPERATIONS],
        id: match[1],
        verifierHash: createHash("sha256").update(match[2]).digest("hex"),
        serverId,
        environment,
      },
    ],
    schedulerIdentity,
    mailMode: local ? "sink" : "gmail",
    ...(input.gmail
      ? {
          gmail: {
            ...input.gmail,
            participantEmailPattern,
            clientSecret: secret(input.gmail.clientSecret),
            refreshToken: secret(input.gmail.refreshToken),
          },
        }
      : {}),
  }
  const env = {
    AERPP_ENVIRONMENT: target.name,
    GCP_PROJECT_ID: target.project,
    SUPPORT_RUNTIME_JSON: JSON.stringify(runtime),
    ...(local
      ? { FIRESTORE_EMULATOR_HOST: input.local.firestoreEmulatorHost }
      : {}),
  }
  readSupportEnvironment(env)
  return env
}
