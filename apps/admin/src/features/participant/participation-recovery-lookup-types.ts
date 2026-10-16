import { ParticipantRecordOwnerSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

export const recoveryLookupInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("email"),
    value: z.string().trim().toLowerCase().pipe(z.email()),
  }),
  z.object({
    mode: z.literal("pid"),
    value: ParticipantRecordOwnerSchema.shape.pseudonym,
  }),
])

export type RecoveryRecord = {
  eventType?: string
  id: string
  time: number | null
  fields: Array<[string, string]>
}

export type RecoveryLookup = {
  pseudonym: string
  loadedAt: number
  serverId: string
  state: RecoveryRecord | null
  events: RecoveryRecord[]
  attempts: RecoveryRecord[]
  questionnaires: RecoveryRecord[]
}

export type RecoveryLookupActionState = {
  message: string
  requestId?: string
  lookup?: RecoveryLookup
}
