import path from "node:path"

export const SURVEY_FILES = ["survey-initial.json", "survey-follow-up.json"]

// Web and Admin use the same directory, including standalone and isolated builds.
export function resolveSurveyPath(filename, appDirectory = process.cwd()) {
  if (!SURVEY_FILES.includes(filename))
    throw new Error("Unsupported questionnaire filename")
  return path.join(
    /*turbopackIgnore: true*/ appDirectory,
    "../../config/common/survey",
    filename,
  )
}
