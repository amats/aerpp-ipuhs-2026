import { z } from "zod"
import { ID_CONSTRAINTS } from "@/features/identity/id-constraints"
import { analysisCompletionMetadataSchema } from "@/features/llm/analysis-completion-types"

const applicationIdSchema = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}[A-Za-z0-9]{${ID_CONSTRAINTS.suffixLength}}$`))

export const analysisIdSchema = applicationIdSchema(
  ID_CONSTRAINTS.analysisIdPrefix,
)

export const analysisCompletionReceiptSchema =
  analysisCompletionMetadataSchema.extend({
    analysisId: analysisIdSchema,
    ownerClientId: applicationIdSchema(ID_CONSTRAINTS.clientIdPrefix),
    ownerPseudonym: applicationIdSchema(ID_CONSTRAINTS.pseudonymPrefix),
  })

export type AnalysisCompletionReceipt = z.infer<
  typeof analysisCompletionReceiptSchema
>
