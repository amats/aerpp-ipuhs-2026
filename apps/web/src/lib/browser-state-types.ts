import { z } from "zod"

import { isSessionGeneration } from "./session-generation"

const scopeSchema = z.string().refine(isSessionGeneration)
export const browserContextSchema = z.object({
  revision: z.number().int().nonnegative(),
  value: z.string().nullable(),
})
export const browserResetSchema = z.object({
  scope: scopeSchema,
  attempt: scopeSchema,
  previousScope: scopeSchema.nullable(),
  replacementScope: scopeSchema,
})
const payloadSchema = z.object({
  version: z.string(),
  value: z.string().nullable(),
})
export const browserStateSchema = z.object({
  scope: scopeSchema,
  revision: z.number().int().nonnegative(),
  reset: browserResetSchema.nullable(),
  recoveryRevision: z.number().int().nonnegative().optional(),
  contexts: z.record(z.string(), browserContextSchema),
  analysisResult: payloadSchema,
  recoveredSurvey: payloadSchema,
})
export type BrowserState = z.infer<typeof browserStateSchema>
export type BrowserReset = z.infer<typeof browserResetSchema>
export type BrowserPayloadKey = "analysisResult" | "recoveredSurvey"
export type BrowserPayloadSnapshot = BrowserState[BrowserPayloadKey] & {
  scope: string
}
export type BrowserAnalysisSnapshot = {
  scope: string
  analysisResultVersion: string
  recoveredSurveyVersion: string
}
