import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { adminAssets } from "./build-admin-image.mjs"

test("Admin image builds do not read or bundle questionnaire inputs", () => {
  assert.deepEqual(adminAssets("test"), [])
  assert.deepEqual(adminAssets("production"), [])
  assert.throws(() => adminAssets("example"))
  const dockerfile = readFileSync(
    new URL("../../apps/admin/Dockerfile", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(dockerfile, /config\/common\/survey/)
  const next = readFileSync(
    new URL("../../apps/admin/next.config.ts", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(next, /surveyAsset|aerpp-surveys/)
})
