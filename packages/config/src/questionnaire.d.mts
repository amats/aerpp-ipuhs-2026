export type QuestionnaireDefinition = {
  survey_version: string
  description: string
  types: {
    type: string
    labels?: Record<string, string>
    [key: string]: unknown
  }[]
  items: {
    type: "section" | "likert7" | "single_choice" | "text"
    item_id?: string
    section_id?: string
    construct?: string
    reverse?: boolean
    question_ja?: string
    options?: string[]
    required?: boolean
    [key: string]: unknown
  }[]
  [key: string]: unknown
}
export type QuestionnaireArtifact = {
  definition: QuestionnaireDefinition
  json: string
  definitionId: string
}
export const QUESTIONNAIRE_ID_PATTERN: RegExp
export const QUESTIONNAIRE_MAX_BYTES: number
export function parseQuestionnaireJson(source: string): QuestionnaireDefinition
export function createQuestionnaireArtifact(
  source: string,
): QuestionnaireArtifact
export function questionnaireObjectName(definitionId: string): string
export function verifyQuestionnaireArtifact(
  source: string,
  definitionId: string,
): QuestionnaireArtifact
export function questionnaireBucket(project: string): string
