import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  createQuestionnaireArtifact,
  parseQuestionnaireJson,
  questionnaireBucket,
  questionnaireObjectName,
  verifyQuestionnaireArtifact,
} from "./questionnaire.mjs"

const source = readFileSync(
  new URL("../../../config/common/survey/survey-initial.json", import.meta.url),
  "utf8",
)
test("JCS identity ignores JSON formatting and object key order, preserving full definitions", () => {
  const original = JSON.parse(source)
  const reordered = Object.fromEntries(Object.entries(original).reverse())
  const first = createQuestionnaireArtifact(source)
  assert.deepEqual(
    createQuestionnaireArtifact(JSON.stringify(reordered, null, 4)),
    first,
  )
  assert.deepEqual(JSON.parse(first.json), original)
  assert.deepEqual(
    verifyQuestionnaireArtifact(first.json, first.definitionId),
    first,
  )
  assert.match(
    questionnaireObjectName(first.definitionId),
    /^questionnaires\/jcs-v1\/sha256\/[a-f0-9]{64}\.json$/,
  )
})
test("question wording, options, order and reverse flags change identity", () => {
  const original = createQuestionnaireArtifact(source)
  for (const change of [
    (value) => {
      value.description += " "
    },
    (value) => {
      value.items.reverse()
    },
    (value) => {
      const item = value.items.find((item) => item.type === "likert7")
      item.reverse = !item.reverse
    },
    (value) => {
      value.types.find((item) => item.labels).labels["1"] += "!"
    },
  ]) {
    const value = JSON.parse(source)
    change(value)
    assert.notEqual(
      createQuestionnaireArtifact(JSON.stringify(value)).definitionId,
      original.definitionId,
    )
  }
})
test("rejects duplicate/invalid JSON, invalid Unicode and non-finite numbers", () => {
  for (const text of [
    '{"x":1,"x":2}',
    '{"a":1,}',
    "[1,]",
    '{"x":"\\ud800"}',
    '{"x":1e999}',
    `${source} false`,
  ])
    assert.throws(() => parseQuestionnaireJson(text))
})
test("archive verification rejects altered contents and non-canonical bytes", () => {
  const artifact = createQuestionnaireArtifact(source)
  assert.throws(() =>
    verifyQuestionnaireArtifact(source, artifact.definitionId),
  )
  assert.throws(() =>
    verifyQuestionnaireArtifact(
      artifact.json,
      `jcs-v1:sha256:${"0".repeat(64)}`,
    ),
  )
  assert.throws(() => questionnaireObjectName("../../other.json"))
  assert.equal(
    questionnaireBucket("synthetic-project"),
    "synthetic-project-questionnaires",
  )
})

test("rejects duplicate keys within otherwise valid definitions, including escaped keys", () => {
  const artifact = createQuestionnaireArtifact(source)
  for (const added of [
    '"description":"replacement",',
    '"descr\\u0069ption":"replacement",',
  ]) {
    assert.throws(
      () => createQuestionnaireArtifact(`{${added}${artifact.json.slice(1)}`),
      /Duplicate/,
    )
  }
})

test("JCS sorts numeric-looking keys lexically and encodes ECMAScript numbers", () => {
  const definition = JSON.parse(source)
  definition.extra = { 2: 1e-7, 10: 1e30, minusZero: -0, small: 0.000001 }
  const artifact = createQuestionnaireArtifact(JSON.stringify(definition))
  assert.ok(
    artifact.json.includes(
      '"extra":{"10":1e+30,"2":1e-7,"minusZero":0,"small":0.000001}',
    ),
  )
})
