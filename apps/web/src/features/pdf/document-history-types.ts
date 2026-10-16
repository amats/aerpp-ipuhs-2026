import { DocumentSetReferenceSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

const documentHistoryRecordSchema = z.object({
  id: z.string().min(1),
  eventType: z.enum(["consent", "withdrawal"]),
  date: z.iso.datetime(),
  documentSet: DocumentSetReferenceSchema,
})
const documentHistoryPeriodSchema = z.object({
  consent: documentHistoryRecordSchema,
  withdrawal: documentHistoryRecordSchema.nullable(),
})
export const documentHistorySchema = z.object({
  current: documentHistoryPeriodSchema,
  previous: z.array(documentHistoryPeriodSchema),
})
export const documentHistoryResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), history: documentHistorySchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type DocumentHistoryRecord = z.infer<typeof documentHistoryRecordSchema>
export type DocumentHistoryPeriod = z.infer<typeof documentHistoryPeriodSchema>
export type DocumentHistory = z.infer<typeof documentHistorySchema>
