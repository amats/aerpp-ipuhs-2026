import { z } from "zod"
import { participantEmailRegexp } from "./participant-email-regexp.mjs"
import { buildSupportUrls, SUPPORT_ROUTES } from "./support-routes.mjs"

export { participantEmailRegexp } from "./participant-email-regexp.mjs"

const MAINTENANCE_MARGIN_MS = 12 * 60 * 60 * 1000

export function supportMaintenanceWindowActive(runtime, now = Date.now()) {
  return runtime.credentials.some(
    (credential) =>
      credential.revoked === false &&
      credential.environment === runtime.environment &&
      now >= credential.notBeforeMs - MAINTENANCE_MARGIN_MS &&
      now < credential.expiresAtMs,
  )
}

const OPERATION_NAMES = Object.keys(SUPPORT_ROUTES).filter(
  (name) => name !== "magicCompletePage",
)
export const CredentialSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    verifierHash: z.string().regex(/^[a-f0-9]{64}$/),
    serverId: z.string().min(1).max(256),
    environment: z.enum(["local", "test", "production"]),
    operations: z
      .array(z.string().refine((name) => OPERATION_NAMES.includes(name)))
      .min(1),
    notBeforeMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().positive(),
    revoked: z.boolean(),
  })
  .strict()
  .refine((value) => value.expiresAtMs > value.notBeforeMs)
const RuntimeSchema = z
  .object({
    environment: z.enum(["local", "test", "production"]),
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),
    baseUrl: z.string(),
    testEmailAddresses: z
      .array(z.string().trim().toLowerCase().email())
      .default([]),
    admissionOpen: z.boolean(),
    maintenanceEnabled: z.boolean(),
    credentials: z.array(CredentialSchema),
    tokenKey: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    schedulerIdentity: z.string().email(),
    contactEmail: z.string().email(),
    mailMode: z.enum(["sink", "gmail"]),
    gmail: z
      .object({
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        refreshToken: z.string().min(1),
        sender: z.string().email(),
        participantEmailPattern: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
export function readSupportEnvironment(env) {
  try {
    const settings = RuntimeSchema.parse(
      JSON.parse(env.SUPPORT_RUNTIME_JSON ?? ""),
    )
    if (settings.gmail)
      participantEmailRegexp(settings.gmail.participantEmailPattern)
    buildSupportUrls(settings.baseUrl)
    const base = new URL(settings.baseUrl)
    if (
      (env.GCP_PROJECT_ID && env.GCP_PROJECT_ID !== settings.projectId) ||
      (env.AERPP_ENVIRONMENT &&
        env.AERPP_ENVIRONMENT !==
          (settings.environment === "local" ? "example" : settings.environment))
    )
      throw new Error()
    if (
      settings.credentials.some(
        (entry) => entry.environment !== settings.environment,
      ) ||
      new Set(settings.credentials.map((entry) => entry.id)).size !==
        settings.credentials.length ||
      settings.credentials.length === 0
    )
      throw new Error()
    if (env.FIREBASE_AUTH_EMULATOR_HOST || env.FUNCTIONS_EMULATOR)
      throw new Error()
    if (settings.environment === "local") {
      if (
        !settings.projectId.startsWith("demo-") ||
        settings.mailMode !== "sink" ||
        settings.gmail ||
        base.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
        !/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]+$/.test(
          env.FIRESTORE_EMULATOR_HOST ?? "",
        ) ||
        env.GOOGLE_APPLICATION_CREDENTIALS ||
        env.GOOGLE_CLOUD_PROJECT ||
        env.GCLOUD_PROJECT
      )
        throw new Error()
    } else if (
      settings.projectId.startsWith("demo-") ||
      settings.tokenKey.startsWith("local-example-") ||
      settings.credentials.some(
        (entry) =>
          entry.id.startsWith("local-example-") ||
          entry.serverId.startsWith("local-example-"),
      ) ||
      settings.mailMode !== "gmail" ||
      !settings.gmail ||
      base.protocol !== "https:" ||
      env.FIRESTORE_EMULATOR_HOST ||
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      [env.GOOGLE_CLOUD_PROJECT, env.GCLOUD_PROJECT].some(
        (value) => value && value !== settings.projectId,
      )
    ) {
      throw new Error()
    }
    return settings
  } catch {
    throw new Error(
      "Invalid support runtime configuration; check the selected environment and required settings",
    )
  }
}
