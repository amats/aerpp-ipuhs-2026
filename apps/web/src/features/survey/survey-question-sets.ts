import "server-only"

import { readFileSync } from "node:fs"
import { createQuestionnaireArtifact } from "@aerpp/config/questionnaire"
import { resolveSurveyPath } from "@aerpp/config/survey"
import { type SurveyJsonItem, surveyJsonSchema } from "./survey-json-types"
import type {
  LikertSurveyQuestion,
  SingleChoiceSurveyQuestion,
  SurveyQuestion,
  SurveyQuestionSet,
  SurveySection,
  TextSurveyQuestion,
} from "./survey-question-types"

function readSurveyData(filename: string) {
  const artifact = createQuestionnaireArtifact(
    readFileSync(resolveSurveyPath(filename), "utf-8"),
  )
  return {
    ...artifact,
    definition: surveyJsonSchema.parse(artifact.definition),
  }
}

function loadSurveyQuestionSet(
  kind: "initial" | "follow-up",
): SurveyQuestionSet {
  const { definition: surveyData, definitionId } = readSurveyData(
    `survey-${kind}.json`,
  )

  const likert7Options = surveyData.types.find((t) => t.type === "likert7")
    ?.labels ?? { "0": "0" }

  const questions: SurveyQuestion[] = surveyData.items.map(
    (item: SurveyJsonItem) => {
      switch (item.type) {
        case "section":
          return {
            type: "section",
            id: item.section_id,
            text: item.heading_ja,
            required: false,
          } as SurveySection
        case "likert7":
          return {
            type: "likert7",
            id: item.item_id,
            text: item.question_ja,
            options: Object.values(likert7Options),
            required: item.required,
          } as LikertSurveyQuestion
        case "text":
          return {
            type: "text",
            id: item.item_id,
            text: item.question_ja,
            placeholder: item.placeholder,
            required: item.required,
          } as TextSurveyQuestion
        case "single_choice":
          return {
            type: "single_choice",
            id: item.item_id,
            text: item.question_ja,
            options: item.options,
            required: item.required,
          } as SingleChoiceSurveyQuestion
        default:
          throw new Error("Unsupported survey item type")
      }
    },
  )

  return {
    version: surveyData.survey_version,
    definitionId,
    description: surveyData.description,
    questions,
  }
}

const initialSurveyQuestionSet = loadSurveyQuestionSet("initial")
const followUpSurveyQuestionSet = loadSurveyQuestionSet("follow-up")

export const surveyQuestionSets = {
  initialSurveyQuestionSet,
  followUpSurveyQuestionSet,
}
