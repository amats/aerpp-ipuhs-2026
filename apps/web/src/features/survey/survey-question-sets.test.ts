import { readFileSync } from "node:fs"
import { resolveSurveyPath } from "@aerpp/config/survey"
import { describe, expect, it } from "vitest"
import { surveyJsonSchema } from "./survey-json-types"
import { surveyQuestionSets } from "./survey-question-sets"
import type { SurveyQuestion } from "./survey-question-types"

describe("surveyQuestionSets", () => {
  function readSurvey(filename: string) {
    return surveyJsonSchema.parse(
      JSON.parse(readFileSync(resolveSurveyPath(filename), "utf-8")),
    )
  }

  function getExpectedQuestionIds(filename: string) {
    return readSurvey(filename).items.map((item) =>
      item.type === "section" ? item.section_id : item.item_id,
    )
  }

  it("maps initial survey JSON items into renderable items without changing order", () => {
    const questionSet = surveyQuestionSets.initialSurveyQuestionSet
    const survey = readSurvey("survey-initial.json")

    expect(questionSet.questions.map((item) => item.id)).toEqual(
      getExpectedQuestionIds("survey-initial.json"),
    )
    expect(questionSet.version).toBe(survey.survey_version)
    expect(
      questionSet.questions
        .filter(
          (item): item is SurveyQuestion & { type: "single_choice" } =>
            item.type === "single_choice",
        )
        .every((item) => item.required),
    ).toBe(true)
    expect(
      questionSet.questions
        .filter(
          (item): item is SurveyQuestion & { type: "section" } =>
            item.type === "section",
        )
        .every((item) => item.required === false),
    ).toBe(true)
  })

  it("maps follow-up survey JSON items into renderable items without changing order", () => {
    const questionSet = surveyQuestionSets.followUpSurveyQuestionSet
    const survey = readSurvey("survey-follow-up.json")

    expect(questionSet.questions.map((item) => item.id)).toEqual(
      getExpectedQuestionIds("survey-follow-up.json"),
    )
    expect(questionSet.version).toBe(survey.survey_version)
  })
})
