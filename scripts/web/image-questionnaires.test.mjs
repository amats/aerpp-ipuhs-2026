import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import test from "node:test"
import { createQuestionnaireArtifact } from "@aerpp/config/questionnaire"
import { SURVEY_FILES } from "@aerpp/config/survey"
import { readImageQuestionnaires } from "./image-questionnaires.mjs"

const artifacts = Object.fromEntries(
  SURVEY_FILES.map((name) => [
    name,
    createQuestionnaireArtifact(
      readFileSync(
        new URL(`../../config/common/survey/${name}`, import.meta.url),
        "utf8",
      ),
    ),
  ]),
)

test("extracts both canonical questionnaires from the immutable image and removes temporary resources", () => {
  const calls = []
  let directory
  const extracted = readImageQuestionnaires(
    `sha256:${"b".repeat(64)}`,
    (command, args) => {
      calls.push([command, ...args])
      if (args[0] === "create") return "a".repeat(64)
      if (args[0] === "cp") {
        directory = dirname(args[2])
        writeFileSync(args[2], artifacts[basename(args[2])].json)
      }
    },
  )
  assert.deepEqual(
    extracted,
    SURVEY_FILES.map((name) => ({ name, ...artifacts[name] })),
  )
  assert.deepEqual(calls.at(-1), ["docker", "rm", "a".repeat(64)])
  assert.equal(existsSync(directory), false)
  assert.throws(() => readImageQuestionnaires("mutable:tag"), /Immutable/)
})

test("removes extracted questionnaires even when container removal fails", (t) => {
  for (const extractionFails of [false, true]) {
    let directory
    t.after(() => {
      if (directory) rmSync(directory, { recursive: true, force: true })
    })
    assert.throws(
      () =>
        readImageQuestionnaires(`sha256:${"b".repeat(64)}`, (command, args) => {
          assert.equal(command, "docker")
          if (args[0] === "create") return "a".repeat(64)
          if (args[0] === "cp") {
            directory = dirname(args[2])
            writeFileSync(args[2], artifacts[basename(args[2])].json)
            if (extractionFails === true)
              throw new Error("synthetic extraction failure")
          }
          if (args[0] === "rm")
            throw new Error("synthetic container removal failure")
        }),
      /synthetic container removal failure/,
    )
    assert.equal(existsSync(directory), false)
  }
})
