import { AnalysisWorkspaceVersionSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

export const analysisCompletionMetadataSchema = z.object({
  analysisId: z.string().min(1),
  analysisWorkspaceVersion: AnalysisWorkspaceVersionSchema,
  modelName: z.string().min(1),
  // Whole seconds from analysis-route admission to output completion, including setup.
  processingDurationSeconds: z.number(),
  documentCount: z.number().int().nonnegative(),
  // Grapheme counts include document names and bodies, without prompt framing.
  documentGraphemeCount: z.number().int().nonnegative(),
  resultGraphemeCount: z.number().int().nonnegative(),
})

export type AnalysisCompletionMetadata = z.infer<
  typeof analysisCompletionMetadataSchema
>
