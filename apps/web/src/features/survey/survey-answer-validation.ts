import "server-only"

import { z } from "zod"
import { Stage } from "@/features/app-context/stage-types"
import { countGraphemes } from "@/lib/graphemes"
import { SURVEY_TEXT_ANSWER_MAX_GRAPHEMES } from "./survey-answer-constraints"
import { surveyQuestionSets } from "./survey-question-sets"
import type { SurveyQuestion, SurveyQuestionSet } from "./survey-question-types"

const surveyAnswerSchema = z.record(z.string(), z.string())
type ValidatedSurveySubmission = {
  answers: Record<string, string | null>
  questionnaire: { kind: "initial" | "follow-up"; definitionId: string }
}

function getSurveyQuestionSet(stage: Stage): SurveyQuestionSet {
  return stage === Stage.followUp
    ? surveyQuestionSets.followUpSurveyQuestionSet
    : surveyQuestionSets.initialSurveyQuestionSet
}

function getAnswerableQuestions(questionSet: SurveyQuestionSet) {
  return questionSet.questions.filter((question) => question.type !== "section")
}

function isValidQuestionAnswer(question: SurveyQuestion, answer: string) {
  if (question.type === "section") {
    return false
  }

  if (
    question.type === "text" &&
    countGraphemes(answer) > SURVEY_TEXT_ANSWER_MAX_GRAPHEMES
  ) {
    return false
  }

  const trimmedAnswer = answer.trim()
  if (trimmedAnswer === "") {
    return question.required !== true
  }

  switch (question.type) {
    case "single_choice":
    case "likert7":
      return question.options.includes(answer)
    case "text":
      return true
  }
}

export function validateSurveySubmissionInput({
  stage,
  survey,
  definitionId,
}: {
  stage: Stage
  survey: unknown
  definitionId: unknown
}): ValidatedSurveySubmission | null {
  const parsedSurvey = surveyAnswerSchema.safeParse(survey)
  if (!parsedSurvey.success) {
    return null
  }

  const questionSet = getSurveyQuestionSet(stage)
  if (definitionId !== questionSet.definitionId) return null
  const answerableQuestions = getAnswerableQuestions(questionSet)
  const questionsById = new Map(
    answerableQuestions.map((question) => [question.id, question]),
  )

  for (const question of answerableQuestions) {
    const answer = parsedSurvey.data[question.id]
    if (
      question.required === true &&
      (typeof answer !== "string" || answer.trim() === "")
    ) {
      return null
    }
  }

  for (const [questionId, answer] of Object.entries(parsedSurvey.data)) {
    const question = questionsById.get(questionId)
    if (!question || !isValidQuestionAnswer(question, answer)) {
      return null
    }
  }

  return {
    answers: Object.fromEntries(
      answerableQuestions.map((question) => [
        question.id,
        Object.hasOwn(parsedSurvey.data, question.id) === true
          ? parsedSurvey.data[question.id]
          : null,
      ]),
    ),
    questionnaire: {
      kind: stage === Stage.followUp ? "follow-up" : "initial",
      definitionId: questionSet.definitionId,
    },
  }
}

export function matchesSurveyDefinition(stage: Stage, definitionId: unknown) {
  return (
    typeof definitionId === "string" &&
    getSurveyQuestionSet(stage).definitionId === definitionId
  )
}
