import {
  PRIVATE_PARTICIPANT_FIELD_NAMES,
  SubmitSurveyRequestSchema,
} from "@aerpp/participant-api-contracts/participant-api"
import { expect, it } from "vitest"
import type { z } from "zod"
import { surveyJsonSchema } from "./survey-json-types"

function questionnaire(): z.input<typeof surveyJsonSchema> {
  return {
    survey_version: "synthetic-v1",
    description: "Synthetic questionnaire",
    types: [
      { type: "section" },
      { type: "single_choice" },
      { type: "text", placeholder: "Optional comment" },
      {
        type: "likert7",
        labels: Object.fromEntries(
          Array.from({ length: 7 }, (_, index) => [
            String(index + 1),
            `Label ${index + 1}`,
          ]),
        ),
      },
    ],
    items: [
      { type: "section", section_id: "section-1", heading_ja: "Section" },
      {
        type: "single_choice",
        construct: "CTX",
        item_id: "Q1",
        question_ja: "Choose",
        options: ["Yes", "No"],
        required: true,
      },
      {
        type: "likert7",
        construct: "PE",
        item_id: "Q2",
        question_ja: "Rate",
        reverse: false,
        required: false,
      },
      {
        type: "text",
        construct: "comment",
        item_id: "Q3",
        question_ja: "Comment",
        required: false,
        placeholder: "Optional comment",
      },
    ],
  }
}

it("retains explicit required flags, labels and section order", () => {
  const input = questionnaire()
  const result = surveyJsonSchema.parse(input)
  expect(result.items.map((item) => item.required)).toEqual([
    false,
    true,
    false,
    false,
  ])
  expect(result.types).toEqual(input.types)
  expect(result.items.slice(1)).toEqual(input.items.slice(1))
})

it.each([
  "",
  "question.1",
  "question/1",
  "question 1",
  "質問1",
  "1question",
  "_question",
  "Q".repeat(129),
  "createdAt",
  "updatedAt",
  "submittedAt",
  "expireAt",
  "status",
  "_integrity",
  "dataPurpose",
  "__proto__",
  "prototype",
  "constructor",
  "serverId",
  "clientId",
  "pseudonym",
  "consentId",
  "analysisId",
  "surveyVersion",
  "modelName",
  "processingDurationSeconds",
  "documentCount",
  "documentGraphemeCount",
  "resultGraphemeCount",
  ...PRIVATE_PARTICIPANT_FIELD_NAMES,
])(
  "rejects unusable question ID %j in every answer type at load time",
  (id) => {
    for (const item of questionnaire().items) {
      if (item.type === "section") continue
      const input = questionnaire()
      input.items = [{ ...item, item_id: id }]
      const result = surveyJsonSchema.safeParse(input)
      expect(result.success).toBe(false)
      if (!result.success)
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ["items", 0, "item_id"] }),
          ]),
        )
    }
  },
)

it.each(["Q", "custom_question-1", "sourceDocumentId", "Q".repeat(128)])(
  "preserves supported custom question ID %j through the API contract",
  (id) => {
    const input = questionnaire()
    const item = input.items.find((item) => item.type === "text")
    if (!item) throw new Error("Missing text item")
    input.items = [{ ...item, item_id: id }]
    expect(surveyJsonSchema.parse(input).items).toEqual(input.items)
    const submission = {
      serverId: "synthetic-server",
      clientId: "synthetic-client",
      pseudonym: "synthetic-participant",
      consentId: "synthetic-consent",
      answers: { [id]: "Synthetic answer" },
      analysisId: "synthetic-analysis",
      questionnaire: {
        kind: "initial",
        definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
      },
    }
    expect(SubmitSurveyRequestSchema.parse(submission)).toEqual(submission)
  },
)

it("allows non-answer section IDs independently of API field restrictions", () => {
  const input = questionnaire()
  input.items = [
    { type: "section", section_id: "section.1", heading_ja: "Section" },
    { type: "section", section_id: "modelName", heading_ja: "Section" },
  ]
  expect(surveyJsonSchema.safeParse(input).success).toBe(true)
})

it.each(["question", "section", "mixed"])(
  "rejects duplicate %s IDs before answers can share a state key",
  (kind) => {
    const input = questionnaire()
    if (kind === "mixed") {
      input.items.push({
        type: "section",
        section_id: "Q1",
        heading_ja: "Another section",
      })
    } else input.items.push(input.items[kind === "section" ? 0 : 1])
    expect(surveyJsonSchema.safeParse(input).success).toBe(false)
  },
)

it("rejects duplicate type definitions and undefined item types", () => {
  const duplicated = questionnaire()
  duplicated.types.push(duplicated.types[3])
  expect(surveyJsonSchema.safeParse(duplicated).success).toBe(false)
  const missing = questionnaire()
  missing.types = missing.types.filter((type) => type.type !== "likert7")
  expect(surveyJsonSchema.safeParse(missing).success).toBe(false)
})

it.each([
  ["Yes", "Yes"],
  ["Yes", "   "],
])(
  "rejects indistinguishable or unanswered single-choice options: %j",
  (...options) => {
    const input = questionnaire()
    const item = input.items.find((item) => item.type === "single_choice")
    if (item?.type !== "single_choice") throw new Error("Missing item")
    item.options = options
    expect(surveyJsonSchema.safeParse(input).success).toBe(false)
  },
)

const INVALID_LIKERT_LABELS: Record<string, string>[] = [
  {},
  { "1": "Same", "2": "Same" },
  { "1": " " },
]
it.each(INVALID_LIKERT_LABELS)(
  "rejects missing, ambiguous or blank Likert labels: %j",
  (labels) => {
    const input = questionnaire()
    input.types = [{ type: "likert7", labels }]
    input.items = input.items.filter((item) => item.type === "likert7")
    expect(surveyJsonSchema.safeParse(input).success).toBe(false)
  },
)

it("requires the questionnaire survey_version key", () => {
  const input = Object.fromEntries(
    Object.entries(questionnaire()).filter(([key]) => key !== "survey_version"),
  )
  const result = surveyJsonSchema.safeParse(input)
  expect(result.success).toBe(false)
  if (!result.success)
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["survey_version"] }),
      ]),
    )
})

it.each([undefined, null, "", 0, 2, false, [], { note: "metadata" }])(
  "rejects absent, non-string or empty questionnaire versions: %j",
  (surveyVersion) => {
    expect(
      surveyJsonSchema.safeParse({
        ...questionnaire(),
        survey_version: surveyVersion,
      }).success,
    ).toBe(false)
  },
)

it.each(["arbitrary-version", "0", "2", "  v1  ", " \t\n "])(
  "preserves a nonempty questionnaire version without format validation: %j",
  (surveyVersion) => {
    const input = { ...questionnaire(), survey_version: surveyVersion }
    expect(surveyJsonSchema.parse(input).survey_version).toEqual(surveyVersion)
  },
)
