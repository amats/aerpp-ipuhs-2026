import { z } from "zod"
import { analysisIdSchema } from "./analysis-receipt-types"

export const analysisJobStatusSchema = z.object({
  ok: z.literal(true),
  analysisId: analysisIdSchema.nullable(),
  status: z.enum([
    "idle",
    "running",
    "recording",
    "ready",
    "completion_pending",
    "termination_pending",
    "failed",
    "cancelled",
    "unconfirmed",
    "unavailable",
  ]),
  startedAtMs: z.number().int().nonnegative().nullable(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  questionnaireKind: z.enum(["initial", "follow-up"]).optional(),
  reason: z
    .enum([
      "timeout",
      "llm_unavailable",
      "invalid_response",
      "completion_failed",
    ])
    .optional(),
  expiresAtMs: z.number().int().nonnegative().optional(),
  canRetry: z.boolean().optional(),
  canRecover: z.boolean().optional(),
})
export type AnalysisJobStatus = z.infer<typeof analysisJobStatusSchema>

export type AnalysisElapsedTime = {
  elapsedMs: number
  // Browser monotonic time when the server's elapsed duration was received.
  receivedAtMs: number
}

export const analysisJobResultSchema = z.object({
  ok: z.literal(true),
  analysisId: analysisIdSchema,
  text: z.string().min(1),
  receipt: z.string().min(1),
})
export type AnalysisJobResult = z.infer<typeof analysisJobResultSchema>

export type AnalysisJobOwner = {
  sessionId: string
  clientId: string
  pseudonym: string
  consentId: string
}

export type AnalysisRetryInput = {
  prompt: string
  documentCount: number
  documentGraphemeCount: number
  documentGraphemeCounts: number[]
}

// Only definite pre-admission failures authorize returning to the input screen.
// Unknown responses continue through observation/recovery, never a new attempt.
export const analysisNotStartedSchema = z.object({
  ok: z.literal(false),
  reason: z.enum([
    "analysis_storage_unavailable",
    "analysis_model_unavailable",
    "analysis_support_unavailable",
    "capacity_unavailable",
    "start_failed",
  ]),
})
