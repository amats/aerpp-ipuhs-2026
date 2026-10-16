import { z } from "zod"
import { analysisCompletionMetadataSchema } from "@/features/llm/analysis-completion-types"

export const analysisResultSchema = analysisCompletionMetadataSchema.extend({
  surveySubmitted: z.boolean().optional(),
  text: z.string().min(1),
  pendingQuestionnaireId: z
    .string()
    .regex(/^jcs-v1:sha256:[a-f0-9]{64}$/)
    .optional(),
  pendingSurveyAnswer: z.record(z.string(), z.string()).optional(),
})

export type AnalysisResult = z.infer<typeof analysisResultSchema>

export type AnalysisResultReadOutcome =
  | { ok: true; result: AnalysisResult | null; surveySubmitted?: true }
  | { ok: false }

export type AnalysisResultWriteOutcome =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "storage_changed" | "write_failed" }

export type SurveyResultSealOutcome =
  | { ok: true; sealedResult: string }
  | {
      ok: false
      reason:
        | "questionnaire_changed"
        | "questionnaire_check_failed"
        | "write_failed"
    }

export type SurveyPreparationOutcome =
  | {
      ok: true
      result: AnalysisResult & {
        pendingSurveyAnswer: NonNullable<AnalysisResult["pendingSurveyAnswer"]>
        pendingQuestionnaireId: string
      }
    }
  | {
      ok: false
      reason:
        | "questionnaire_changed"
        | "questionnaire_check_failed"
        | "analysis_mismatch"
        | "storage_changed"
        | "write_failed"
        | "survey_already_submitted"
    }
