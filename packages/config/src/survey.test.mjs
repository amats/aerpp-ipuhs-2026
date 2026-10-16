import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveSurveyPath, SURVEY_FILES } from "./survey.mjs"

test("Web, Admin and standalone builds resolve the same common questionnaire files", () => {
  for (const root of ["/workspace", "/app", "/isolated-browser-build"])
    for (const app of ["web", "admin"])
      for (const filename of SURVEY_FILES)
        assert.equal(
          resolveSurveyPath(filename, `${root}/apps/${app}`),
          `${root}/config/common/survey/${filename}`,
        )
})

test("questionnaire resolution rejects paths outside the two supported files", () => {
  for (const filename of [
    "",
    "../secret.json",
    "/survey-initial.json",
    "other.json",
  ])
    assert.throws(() => resolveSurveyPath(filename, "/workspace/apps/web"))
})
