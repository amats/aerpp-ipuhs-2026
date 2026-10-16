import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  inventoryGoogleCloud,
  inventoryQueries,
} from "./inventory-google-cloud.mjs"

test("inventory records failures separately from empty results and saves private evidence", () => {
  const root = mkdtempSync(resolve(tmpdir(), "support-inventory-"))
  const commands = []
  try {
    const result = inventoryGoogleCloud(["test", "asia-northeast1"], {
      target: () => ({ project: "synthetic-test-project" }),
      output: () => root,
      execute: (project, args) => {
        assert.equal(project, "synthetic-test-project")
        commands.push(args)
        if (args[0] === "run") throw new Error("sensitive provider failure")
        if (args[1] === "databases")
          return JSON.stringify([
            { name: "projects/synthetic-test-project/databases/(default)" },
          ])
        return "[]"
      },
    })
    assert.equal(result.complete, false)
    assert.deepEqual(result.checks.services, { ok: false })
    assert.equal(result.checks.scheduler.count, 0)
    const file = resolve(result.directory, "summary.json")
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.ok(
      !readFileSync(file, "utf8").includes("sensitive provider failure"),
    )
    assert.ok(commands.some((args) => args.includes("--database=(default)")))
    assert.ok(
      !commands
        .flat()
        .some((arg) =>
          ["access", "create", "update", "delete", "deploy"].includes(arg),
        ),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test("inventory rejects other targets and unbounded metadata projections", () => {
  assert.throws(() => inventoryGoogleCloud(["example", "asia-northeast1"]))
  assert.throws(() => inventoryQueries("--help"))
  for (const [, args] of inventoryQueries("asia-northeast1")) {
    assert.ok(args.some((arg) => arg.startsWith("--format=json(")))
    assert.ok(!args.join(" ").includes("environmentVariables"))
  }
})
