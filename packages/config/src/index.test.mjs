import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveGcpProjectId, resolveParticipantApiUrl } from "./index.mjs"

test("project selection accepts matching Google runtime variables and rejects conflicting targets", () => {
  assert.equal(
    resolveGcpProjectId({
      GCP_PROJECT_ID: "demo-test",
      GOOGLE_CLOUD_PROJECT: "demo-test",
    }),
    "demo-test",
  )
  assert.throws(
    () =>
      resolveGcpProjectId({
        GCP_PROJECT_ID: "demo-test",
        GCLOUD_PROJECT: "other-project",
      }),
    /Conflicting/,
  )
  assert.equal(
    resolveParticipantApiUrl("https://support.example.invalid"),
    "https://support.example.invalid/",
  )
})

test("endpoint URLs reject relative paths, remote HTTP and sensitive URL components", () => {
  for (const value of [
    "",
    "/sendMagicLink",
    "http://remote.invalid",
    "https://user:pass@example.com",
    "https://example.com/?secret=1",
    "https://example.com/#fragment",
  ])
    assert.throws(
      () => resolveParticipantApiUrl(value),
      /absolute participant API URL/,
    )
  assert.equal(
    resolveParticipantApiUrl(
      "http://127.0.0.1:8090/api/participant/send-magic-link",
    ),
    "http://127.0.0.1:8090/api/participant/send-magic-link",
  )
})
