export const SURVEY_FILES: readonly [
  "survey-initial.json",
  "survey-follow-up.json",
]
export function resolveSurveyPath(
  filename: string,
  appDirectory?: string,
): string
