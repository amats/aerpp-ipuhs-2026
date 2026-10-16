import { readFileSync } from "node:fs"
import { createQuestionnaireArtifact } from "@aerpp/config/questionnaire"
import { resolveSurveyPath } from "@aerpp/config/survey"
export const initialDefinitionId = createQuestionnaireArtifact(
  readFileSync(resolveSurveyPath("survey-initial.json"), "utf8"),
).definitionId
export const followUpDefinitionId = createQuestionnaireArtifact(
  readFileSync(resolveSurveyPath("survey-follow-up.json"), "utf8"),
).definitionId
