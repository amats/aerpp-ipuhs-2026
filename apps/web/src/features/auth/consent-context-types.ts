import { SendMagicLinkRequestSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

export const consentContextSchema = SendMagicLinkRequestSchema.extend({
  purpose: z.literal("consent"),
  coordinationId: z.string().min(1),
}).strict()

export type PrepareConsentResult =
  | { ok: true; consentContext: string }
  | { ok: false; reason: string }
