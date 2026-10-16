import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  createQuestionnaireArtifact,
  questionnaireBucket,
} from "@aerpp/config/questionnaire"
import {
  assertQuestionnaireRegistration,
  registerQuestionnaire,
} from "./prepare-questionnaires.mjs"

const artifact = createQuestionnaireArtifact(
  readFileSync(
    new URL("../../config/common/survey/survey-initial.json", import.meta.url),
    "utf8",
  ),
)
test("registration is create-only and verifies both new and existing objects", async () => {
  for (const status of [200, 412]) {
    const calls = []
    await registerQuestionnaire(
      "synthetic-bucket",
      artifact,
      "synthetic-token",
      async (url, options) => {
        calls.push({ url, options })
        return calls.length === 1
          ? new Response(null, { status })
          : new Response(artifact.json)
      },
    )
    assert.match(calls[0].url, /ifGenerationMatch=0/)
    assert.equal(calls[0].options.body, artifact.json)
    assert.equal(calls.length, 2)
  }
})
test("existing corrupt or missing archives cannot authorize distribution", async () => {
  for (const response of [
    new Response("{}"),
    new Response(null, { status: 404 }),
  ]) {
    let count = 0
    await assert.rejects(
      registerQuestionnaire(
        "synthetic-bucket",
        artifact,
        "synthetic-token",
        async () =>
          ++count === 1 ? new Response(null, { status: 412 }) : response,
      ),
    )
  }
})
test("the bundle gate binds registration to project, image and both definitions", () => {
  const image = {
    imageId: `sha256:${"a".repeat(64)}`,
    questionnaires: [
      { name: "survey-initial.json", definitionId: artifact.definitionId },
      { name: "survey-follow-up.json", definitionId: artifact.definitionId },
    ],
  }
  const receipt = {
    version: 1,
    project: "synthetic-project",
    bucket: questionnaireBucket("synthetic-project"),
    ...image,
  }
  assertQuestionnaireRegistration(receipt, image, receipt.project)
  assert.throws(() =>
    assertQuestionnaireRegistration(undefined, image, receipt.project),
  )
  assert.throws(() =>
    assertQuestionnaireRegistration(
      receipt,
      { ...image, imageId: "other" },
      receipt.project,
    ),
  )
  assert.throws(() =>
    assertQuestionnaireRegistration(receipt, image, "other-project"),
  )
  assert.throws(() =>
    assertQuestionnaireRegistration(
      receipt,
      { ...image, questionnaires: [] },
      receipt.project,
    ),
  )
})
