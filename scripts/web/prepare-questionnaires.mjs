import assert from "node:assert/strict"
import { readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  questionnaireBucket,
  questionnaireObjectName,
  verifyQuestionnaireArtifact,
} from "@aerpp/config/questionnaire"
import { environmentTarget } from "@aerpp/config/targets"
import {
  cloudEnvironment,
  gcloud,
  outputDirectory,
  privateJson,
} from "../shared/delivery.mjs"
import { readImageQuestionnaires } from "./image-questionnaires.mjs"

export async function registerQuestionnaire(
  bucket,
  artifact,
  token,
  request = fetch,
) {
  const name = questionnaireObjectName(artifact.definitionId)
  verifyQuestionnaireArtifact(artifact.json, artifact.definitionId)
  const headers = { Authorization: `Bearer ${token}` }
  const upload = await request(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: artifact.json,
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (upload.ok !== true && upload.status !== 412)
    throw new Error("Questionnaire registration failed")
  // A lost upload response can be retried safely; existing objects must also match.
  const stored = await request(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
    {
      headers,
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (stored.ok !== true)
    throw new Error("Questionnaire registration verification failed")
  verifyQuestionnaireArtifact(await stored.text(), artifact.definitionId)
}

export function assertQuestionnaireRegistration(receipt, image, project) {
  assert.equal(
    receipt?.version,
    1,
    "Register questionnaires before exporting Web",
  )
  assert.equal(receipt.project, project)
  assert.equal(receipt.imageId, image.imageId)
  assert.equal(receipt.bucket, questionnaireBucket(project))
  assert.deepEqual(receipt.questionnaires, image.questionnaires)
  assert.ok(
    Array.isArray(image.questionnaires) && image.questionnaires.length === 2,
  )
}

export async function main(args = process.argv.slice(2)) {
  const [environment, option, ...extra] = args
  cloudEnvironment(environment)
  if (extra.length > 0 || (option !== undefined && option !== "--apply"))
    throw new Error(
      "Usage: web:prepare-questionnaires test|production [--apply]",
    )
  const target = environmentTarget(environment)
  const output = outputDirectory(environment)
  const receiptPath = resolve(output, "web-questionnaires.json")
  // A failed re-verification must not leave earlier distribution evidence usable.
  if (option === "--apply") rmSync(receiptPath, { force: true })
  const image = JSON.parse(
    readFileSync(resolve(output, "web-image.json"), "utf8"),
  )
  const checked = JSON.parse(
    readFileSync(resolve(output, "web-image-check.json"), "utf8"),
  )
  assert.equal(image.environment, environment)
  assert.equal(checked.project, target.project)
  assert.equal(checked.imageId, image.imageId)
  assert.equal(checked.publicPages, true)
  assert.equal(checked.buildInputSha256, image.buildInputSha256)
  const artifacts = readImageQuestionnaires(image.imageId)
  const questionnaires = artifacts.map(({ name, definitionId }) => ({
    name,
    definitionId,
  }))
  assert.deepEqual(questionnaires, image.questionnaires)
  if (option !== "--apply") {
    console.log(
      `Verified ${artifacts.length} image questionnaires; use --apply to register in the selected project's archive`,
    )
    return
  }
  const bucket = questionnaireBucket(target.project)
  const token = gcloud(target.project, ["auth", "print-access-token"])
  for (const artifact of artifacts)
    await registerQuestionnaire(bucket, artifact, token)
  privateJson(receiptPath, {
    version: 1,
    _comment:
      "Generated; do not edit. Verified questionnaire registration for this immutable Web image.",
    project: target.project,
    bucket,
    imageId: image.imageId,
    questionnaires,
  })
  console.log(
    "Image questionnaires registered and verified; Web bundle export is enabled",
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Questionnaire preparation failed; verify the selected environment configuration, image checks and archive access",
    )
    process.exitCode = 1
  })
