export type {
  ParticipantResearchSnapshot as ResearchSource,
  ParticipantSourceDocument as SourceDocument,
} from "@aerpp/firestore/participant-snapshot-types"
export type QuestionnaireFiles = Record<string, string>
export type QuestionDefinition = {
  survey_version: string
  types?: { type: string; labels?: Record<string, string> }[]
  items: {
    item_id?: string
    type: string
    construct?: string
    reverse?: boolean
    question_ja?: string
    options?: string[]
    required?: boolean
  }[]
}
