import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { reviewSavedTerraformPlan } from "./saved-plan.mjs"

test("saved-plan review rejects source/byte drift before reading a plan and never applies", (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "aerpp-saved-plan-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const plan = {
    variables: {
      project_id: { value: "synthetic-test" },
      region: { value: "asia-northeast1" },
    },
    resource_changes: [],
  }
  const calls = []
  const context = {
    directory,
    project: "synthetic-test",
    region: "asia-northeast1",
    sourceFingerprint: "synthetic-source",
    inputs: {},
    action: "plan",
    invoke: (args) => {
      calls.push(args)
      if (args[0] === "plan") {
        const file = args.find((arg) => arg.startsWith("-out=")).slice(5)
        writeFileSync(file, "synthetic-plan-bytes")
        return ""
      }
      assert.equal(args[0], "show")
      return JSON.stringify(plan)
    },
  }
  const saved = reviewSavedTerraformPlan(context)
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(directory, "plan.json"))),
    plan,
  )
  calls.length = 0
  assert.throws(
    () =>
      reviewSavedTerraformPlan({
        ...context,
        action: "apply",
        sourceFingerprint: "changed",
      }),
    /create and review a new plan/,
  )
  assert.deepEqual(calls, [])
  writeFileSync(saved.planFile, "tampered-bytes")
  assert.throws(
    () => reviewSavedTerraformPlan({ ...context, action: "apply" }),
    /create and review a new plan/,
  )
  assert.deepEqual(calls, [])
})
