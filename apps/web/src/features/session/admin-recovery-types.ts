import { ParticipationRecoverySchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

export const adminRecoveryRequestSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("check") }).strict(),
  z.object({ intent: z.literal("begin"), recoveryId: z.uuid() }).strict(),
  z.object({ intent: z.literal("ready"), recoveryId: z.uuid() }).strict(),
])

export const adminRecoveryResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    recovery: ParticipationRecoverySchema,
    sessionToken: z.string(),
    cleanupRevision: z.number().int().positive().optional(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])

export type AdminRecoveryRequest = z.infer<typeof adminRecoveryRequestSchema>
