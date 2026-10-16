import assert from "node:assert/strict"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { findWorkspaceLayoutViolations } from "./check-workspace-layout.mjs"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aerpp-layout-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const file of [
    ".dockerignore",
    ...["web", "admin", "support"].map(
      (app) => `apps/${app}/Dockerfile.dockerignore`,
    ),
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    copyFileSync(new URL(`../../${file}`, import.meta.url), join(root, file))
  }
  for (const owner of [
    "apps/web",
    "apps/admin",
    "apps/support",
    "packages/config",
  ]) {
    mkdirSync(join(root, owner, "src"), { recursive: true })
    writeFileSync(
      join(root, owner, "src/index.mjs"),
      "export const synthetic = true\n",
    )
    writeFileSync(
      join(root, owner, "package.json"),
      JSON.stringify({
        private: true,
        exports: { ".": { default: "./src/index.mjs" } },
        files: ["src/*.mjs", "!src/*.test.mjs"],
      }),
    )
  }
  return root
}

test("accepts the common source layout and per-application Docker inputs", (t) => {
  assert.deepEqual(findWorkspaceLayoutViolations(fixture(t)), [])
})

test("rejects a package becoming publishable or exporting outside src", (t) => {
  const root = fixture(t)
  writeFileSync(
    join(root, "packages/config/package.json"),
    JSON.stringify({
      private: false,
      exports: { ".": "./private/settings.mjs" },
    }),
  )
  const findings = findWorkspaceLayoutViolations(root)
  assert.ok(findings.some((line) => line.includes("private to true")))
  assert.ok(findings.some((line) => line.includes("must live in src")))
  assert.ok(findings.some((line) => line.includes("files allowlist")))
})

test("rejects app-local private inputs and alternate fixture directories", (t) => {
  const root = fixture(t)
  mkdirSync(join(root, "apps/admin/private"))
  mkdirSync(join(root, "apps/web/fixtures"))
  const findings = findWorkspaceLayoutViolations(root)
  assert.ok(findings.some((line) => line.includes("misplaced private/")))
  assert.ok(findings.some((line) => line.includes("misplaced fixtures/")))
})

test("rejects exclusion drift and re-inclusion after the shared privacy boundary", (t) => {
  const root = fixture(t)
  const file = join(root, "apps/admin/Dockerfile.dockerignore")
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("**/private\n", "") +
      "!apps/admin/src/private/**\n",
  )
  const findings = findWorkspaceLayoutViolations(root)
  assert.ok(findings.some((line) => line.includes("lacks shared")))
  assert.ok(findings.some((line) => line.includes("exclusions differ")))
  assert.ok(findings.some((line) => line.includes("must not override")))
})
