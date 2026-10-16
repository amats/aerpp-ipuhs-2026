import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { runWorkspaceChecks } from "./check-workspace.mjs"
import { createWorkspace } from "./test-support/workspace.mjs"

test("runs checks sequentially in the selected workspace", (t) => {
  const { root, write } = createWorkspace(t, "aerpp-check-sequence-")
  write(
    "first.mjs",
    'import { writeFileSync } from "node:fs"; writeFileSync("order", "first");',
  )
  write(
    "second.mjs",
    'import { appendFileSync, readFileSync } from "node:fs"; if (readFileSync("order", "utf8") !== "first") process.exit(2); appendFileSync("order", ",second");',
  )
  assert.equal(
    runWorkspaceChecks({
      cwd: root,
      steps: [
        [process.execPath, "first.mjs"],
        [process.execPath, "second.mjs"],
      ],
    }),
    0,
  )
  assert.equal(readFileSync(path.join(root, "order"), "utf8"), "first,second")
})

test("preserves the failing exit code and skips remaining checks", (t) => {
  const { root, write } = createWorkspace(t, "aerpp-check-failure-")
  write("order", "")
  write("fail.mjs", "process.exit(7)")
  write(
    "late.mjs",
    'import { writeFileSync } from "node:fs"; writeFileSync("order", "unexpected");',
  )
  assert.equal(
    runWorkspaceChecks({
      cwd: root,
      steps: [
        [process.execPath, "fail.mjs"],
        [process.execPath, "late.mjs"],
      ],
    }),
    7,
  )
  assert.equal(readFileSync(path.join(root, "order"), "utf8"), "")
})

test("reports unavailable commands and interrupted checks as failures", (t) => {
  const { root } = createWorkspace(t, "aerpp-check-interruption-")
  assert.equal(
    runWorkspaceChecks({ cwd: root, steps: [[path.join(root, "missing")]] }),
    1,
  )
  assert.equal(
    runWorkspaceChecks({
      cwd: root,
      steps: [[process.execPath, "-e", 'process.kill(process.pid, "SIGTERM")']],
    }),
    143,
  )
})
