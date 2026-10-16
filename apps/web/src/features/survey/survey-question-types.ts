import { z } from "zod"

export const surveySectionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.literal("section"),
  required: z.boolean(),
})

export type SurveySection = z.infer<typeof surveySectionSchema>

export const likertSurveyQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.literal("likert7"),
  description: z.array(z.string()),
  options: z.array(z.string().min(1)).min(1),
  required: z.boolean(),
})

export type LikertSurveyQuestion = z.infer<typeof likertSurveyQuestionSchema>

export const textSurveyQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.literal("text"),
  placeholder: z.string(),
  required: z.boolean(),
})

export type TextSurveyQuestion = z.infer<typeof textSurveyQuestionSchema>

export const singleChoiceSurveyQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.literal("single_choice"),
  options: z.array(z.string().min(1)).min(1),
  required: z.boolean(),
})

export type SingleChoiceSurveyQuestion = z.infer<
  typeof singleChoiceSurveyQuestionSchema
>

export const surveyQuestionSchema = z.discriminatedUnion("type", [
  surveySectionSchema,
  likertSurveyQuestionSchema,
  textSurveyQuestionSchema,
  singleChoiceSurveyQuestionSchema,
])

export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>

export type SurveyQuestionSet = {
  definitionId: string
  version: string
  description: string
  questions: SurveyQuestion[]
}
