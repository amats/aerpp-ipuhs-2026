import { expect, it, vi } from "vitest"
import { Stage } from "@/features/app-context/stage-types"
import { validateSurveySubmissionInput } from "./survey-answer-validation"
import type { SurveyQuestionSet } from "./survey-question-types"

const questionSet = vi.hoisted(
  (): SurveyQuestionSet => ({
    definitionId: `jcs-v1:sha256:${"a".repeat(64)}`,
    version: "synthetic-v1",
    description: "Synthetic questionnaire",
    questions: [],
  }),
)
vi.mock("./survey-question-sets", () => ({
  surveyQuestionSets: {
    initialSurveyQuestionSet: questionSet,
    followUpSurveyQuestionSet: questionSet,
  },
}))

it.each(["toString", "valueOf", "hasOwnProperty"])(
  "treats an inherited property as a missing required answer: %s",
  (id) => {
    questionSet.questions = [
      { id, text: "Question", type: "text", placeholder: "", required: true },
    ]
    const validate = (survey: unknown) =>
      validateSurveySubmissionInput({
        stage: Stage.authenticated,
        survey,
        definitionId: questionSet.definitionId,
      })
    expect(validate({})).toBeNull()
    expect(validate({ [id]: "answer" })).toEqual({
      answers: { [id]: "answer" },
      questionnaire: {
        kind: "initial",
        definitionId: questionSet.definitionId,
      },
    })
  },
)

it("rejects an old definition even when its answers would be valid under the current form", () => {
  questionSet.questions = [
    {
      id: "Q1",
      type: "text",
      text: "Changed wording",
      required: true,
      placeholder: "",
    },
  ]
  expect(
    validateSurveySubmissionInput({
      stage: Stage.authenticated,
      survey: { Q1: "valid text" },
      definitionId: `jcs-v1:sha256:${"b".repeat(64)}`,
    }),
  ).toBeNull()
})
it("includes untouched optional IDs as null without reading inherited properties", () => {
  questionSet.questions = [
    {
      id: "toString",
      type: "text",
      text: "Optional",
      required: false,
      placeholder: "",
    },
  ]
  expect(
    validateSurveySubmissionInput({
      stage: Stage.authenticated,
      survey: {},
      definitionId: questionSet.definitionId,
    })?.answers,
  ).toEqual({ toString: null })
})
