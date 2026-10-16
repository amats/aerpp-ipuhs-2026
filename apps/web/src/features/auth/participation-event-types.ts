import { ParticipationEventRecordSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

export const participationEventApiSchema = ParticipationEventRecordSchema.and(
  z.object({
    id: z.string().min(1),
    consentId: z.string().min(1).optional(),
    precedingWithdrawalId: z.string().min(1).nullable().optional(),
    serverId: z.string().min(1),
    clientId: z.string().min(1),
    pseudonym: z.string().min(1),
    encryptedEmail: z.string().min(1),
  }),
)

export const participationEventSchema = participationEventApiSchema.transform(
  (record, ctx) => {
    const timestamp =
      record.eventType === "consent"
        ? record.consentConfirmedAt
        : record.withdrawalAcceptedAt
    if (!timestamp) {
      ctx.addIssue({
        code: "custom",
        message: "Missing consent or withdrawal event time",
      })
      return z.NEVER
    }
    return { ...record, eventAt: new Date(timestamp) }
  },
)

export type ParticipationEventRecord = z.infer<typeof participationEventSchema>
