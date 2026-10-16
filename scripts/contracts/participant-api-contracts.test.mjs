import assert from "node:assert/strict"
import { readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import {
  ErrorResponseSchema,
  RecordAnalysisCompletionRequestSchema,
  SurveyAnswerFieldNameSchema,
} from "../../packages/contracts/src/participant-api.ts"

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)

test("participant errors require a code and preserve unknown future codes", () => {
  const error = { error: "synthetic failure", code: "FUTURE_ERROR" }
  assert.deepEqual(ErrorResponseSchema.parse(error), error)
  for (const body of [
    { error: error.error },
    { error: error.error, code: null },
    { error: error.error, code: 500 },
    { code: error.code },
  ])
    assert.equal(ErrorResponseSchema.safeParse(body).success, false)
})

test("analysis completion requires the analysis workspace version and reserves its answer key", () => {
  const metadata = {
    analysisId: "analysis-1",
    serverId: "server-1",
    clientId: "client-1",
    pseudonym: "participant-1",
    consentId: "consent-1",
    analysisWorkspaceVersion: "1.0.0-rc.1",
  }
  assert.deepEqual(
    RecordAnalysisCompletionRequestSchema.parse(metadata),
    metadata,
  )
  for (const version of [undefined, null, "", 1, "a".repeat(129)])
    assert.equal(
      RecordAnalysisCompletionRequestSchema.safeParse({
        ...metadata,
        analysisWorkspaceVersion: version,
      }).success,
      false,
    )
  assert.equal(
    SurveyAnswerFieldNameSchema.safeParse("analysisWorkspaceVersion").success,
    false,
  )
})

test("Web resolves both participant API contract exports to the shared package", () => {
  for (const [entry, file] of [
    ["participant-api", "participant-api.ts"],
    ["openapi.yaml", "openapi.yaml"],
  ]) {
    assert.equal(
      realpathSync(
        webRequire.resolve(`@aerpp/participant-api-contracts/${entry}`),
      ),
      realpathSync(
        new URL(`../../packages/contracts/src/${file}`, import.meta.url),
      ),
    )
  }
  const manifest = JSON.parse(
    readFileSync(new URL("../../apps/web/package.json", import.meta.url)),
  )
  assert.equal(
    manifest.dependencies["@aerpp/participant-api-contracts"],
    "workspace:*",
  )
})
