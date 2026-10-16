import { z } from "zod"
import { rootStepSchema } from "@/features/app-context/root-step-types"
import { stageSchema } from "@/features/app-context/stage-types"

export const sessionStatusSchema = z.object({
  admitted: z.boolean(),
  analysisId: z.string().nullable(),
  submitted: z.string().nullable(),
  withdrawing: z.boolean(),
  stepState: z.object({ stage: stageSchema, step: rootStepSchema }),
})

export type SessionStatus = z.infer<typeof sessionStatusSchema>
