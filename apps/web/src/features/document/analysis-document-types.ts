import { z } from "zod"
import { DOCUMENT_CONSTRAINTS } from "./document-constraints"

export const analysisDocumentSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(DOCUMENT_CONSTRAINTS.maxDocumentNameCodeUnits),
  text: z.string().max(DOCUMENT_CONSTRAINTS.maxDocumentCodeUnits),
})

export type AnalysisDocument = z.infer<typeof analysisDocumentSchema>
