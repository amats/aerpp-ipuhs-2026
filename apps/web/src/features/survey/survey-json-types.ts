import { SurveyAnswerFieldNameSchema } from "@aerpp/participant-api-contracts/participant-api"
import { z } from "zod"

const surveyOptionSchema = z.string().refine((value) => value.trim() !== "", {
  message: "Options must not be blank",
})

const likertSurveyTypeSchema = z.object({
  type: z.literal("likert7"),
  labels: z.record(z.string(), surveyOptionSchema).refine(
    (labels) => {
      const values = Object.values(labels)
      return values.length > 0 && new Set(values).size === values.length
    },
    { message: "Likert labels must be present and unique" },
  ),
})

const textSurveyTypeSchema = z.object({
  type: z.literal("text"),
  placeholder: z.string(),
})

const singleChoiceSurveyTypeSchema = z.object({
  type: z.literal("single_choice"),
})

const sectionSurveyTypeSchema = z.object({
  type: z.literal("section"),
})

const surveyJsonTypeSchema = z.discriminatedUnion("type", [
  likertSurveyTypeSchema,
  textSurveyTypeSchema,
  singleChoiceSurveyTypeSchema,
  sectionSurveyTypeSchema,
])

const sectionSurveyItemSchema = z.object({
  type: z.literal("section"),
  section_id: z.string().min(1),
  heading_ja: z.string().min(1),
  required: z.boolean().default(false),
})

const likertSurveyItemSchema = z.object({
  type: z.literal("likert7"),
  construct: z.string(),
  item_id: SurveyAnswerFieldNameSchema,
  reverse: z.boolean(),
  question_ja: z.string().min(1),
  required: z.boolean(),
})

const textSurveyItemSchema = z.object({
  type: z.literal("text"),
  construct: z.string(),
  item_id: SurveyAnswerFieldNameSchema,
  question_ja: z.string().min(1),
  required: z.boolean(),
  placeholder: z.string(),
})

const singleChoiceSurveyItemSchema = z.object({
  type: z.literal("single_choice"),
  construct: z.string(),
  item_id: SurveyAnswerFieldNameSchema,
  question_ja: z.string().min(1),
  options: z
    .array(surveyOptionSchema)
    .min(1)
    .refine((values) => new Set(values).size === values.length, {
      message: "Options must be unique",
    }),
  required: z.boolean(),
})

const surveyJsonItemSchema = z.discriminatedUnion("type", [
  sectionSurveyItemSchema,
  likertSurveyItemSchema,
  textSurveyItemSchema,
  singleChoiceSurveyItemSchema,
])

export type SurveyJsonItem = z.infer<typeof surveyJsonItemSchema>

export const surveyJsonSchema = z
  .object({
    survey_version: z.string().min(1),
    description: z.string().min(1),
    types: z.array(surveyJsonTypeSchema),
    items: z.array(surveyJsonItemSchema),
  })
  .superRefine((survey, context) => {
    const types = new Set<string>()
    for (const [index, definition] of survey.types.entries()) {
      if (types.has(definition.type))
        context.addIssue({
          code: "custom",
          path: ["types", index, "type"],
          message: "Type definitions must be unique",
        })
      types.add(definition.type)
    }
    const ids = new Set<string>()
    for (const [index, item] of survey.items.entries()) {
      const id = item.type === "section" ? item.section_id : item.item_id
      if (ids.has(id))
        context.addIssue({
          code: "custom",
          path: [
            "items",
            index,
            item.type === "section" ? "section_id" : "item_id",
          ],
          message: "Question and section IDs must be unique",
        })
      ids.add(id)
      if (!types.has(item.type))
        context.addIssue({
          code: "custom",
          path: ["items", index, "type"],
          message: "Item type must have a definition",
        })
    }
  })
