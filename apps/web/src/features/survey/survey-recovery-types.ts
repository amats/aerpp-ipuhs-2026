import { z } from "zod"

export const recoveredSurveyDraftSchema = z
  .object({
    analysisId: z.string().min(1).max(256),
    definitionId: z.string().min(1).max(256),
    answers: z.record(z.string(), z.string()),
  })
  .strict()
export type RecoveredSurveyDraft = z.infer<typeof recoveredSurveyDraftSchema>
