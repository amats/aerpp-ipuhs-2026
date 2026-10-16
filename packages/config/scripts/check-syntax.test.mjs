import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

function workspace(t) {
  const root = mkdtempSync(path.join(tmpdir(), "aerpp-config-syntax-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, "scripts"))
  mkdirSync(path.join(root, "src"))
  copyFileSync(
    new URL("./check-syntax.mjs", import.meta.url),
    path.join(root, "scripts/check-syntax.mjs"),
  )
  const write = (file, source) =>
    writeFileSync(path.join(root, "src", file), source)
  const check = () =>
    spawnSync(process.execPath, [path.join(root, "scripts/check-syntax.mjs")], {
      cwd: tmpdir(),
      encoding: "utf8",
    })
  return { write, check }
}

test("checks runtime syntax without executing modules or including tests", (t) => {
  const { write, check } = workspace(t)
  write("runtime.mjs", 'throw new Error("must not execute")')
  write("runtime.test.mjs", "export const =")
  write("runtime.d.mts", "invalid declaration")
  assert.equal(check().status, 0)
})

test("discovers newly added runtime modules and rejects their invalid syntax", (t) => {
  const { write, check } = workspace(t)
  write("runtime.mjs", "export const valid = true")
  assert.equal(check().status, 0)
  write("new-runtime.mjs", "export const =")
  const result = check()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /new-runtime\.mjs/)
})
