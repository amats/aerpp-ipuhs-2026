import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { symlinkSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import { createWorkspace } from "./test-support/workspace.mjs"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

function runnerWorkspace(t, owner, configName, overrides, fixture, source) {
  const { root, write } = createWorkspace(t, "aerpp-runner-policy-")
  const dependencies = path.join(ROOT, owner, "node_modules")
  symlinkSync(dependencies, path.join(root, "node_modules"), "dir")
  const configUrl = pathToFileURL(path.join(ROOT, owner, configName)).href
  write(
    "runner.config.mjs",
    `import imported from ${JSON.stringify(configUrl)}\nconst config = imported.default ?? imported\nexport default { ...config, ${overrides} }\n`,
  )
  write(fixture, source)
  return { root, dependencies }
}

function runFixture(root, cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: applicationEnvironment({ CI: "", NO_COLOR: "1" }),
    encoding: "utf8",
    timeout: 30_000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

for (const [owner, config] of [
  ["apps/web", "vitest.config.mts"],
  ["apps/admin", "vitest.config.mts"],
  ["apps/support", "vitest.config.ts"],
  ["packages/firestore", "vitest.config.mts"],
]) {
  test(`${owner} unit verification rejects focused tests without CI`, (t) => {
    const { root, dependencies } = runnerWorkspace(
      t,
      owner,
      config,
      'test: { ...config.test, include: ["focus.test.ts"], setupFiles: [] }',
      "focus.test.ts",
      'import { it } from "vitest"\nit.only("synthetic focus", () => {})\n',
    )
    const result = runFixture(
      root,
      path.join(dependencies, "vitest/vitest.mjs"),
      ["run", "--config", "runner.config.mjs"],
    )
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /Unexpected \.only modifier/)
  })
}

for (const [owner, config] of [
  ["apps/web", "playwright.config.ts"],
  ["apps/admin", "playwright.config.mts"],
  ["apps/support", "playwright.config.ts"],
]) {
  test(`${owner} browser verification rejects focused tests without application services`, (t) => {
    const { root, dependencies } = runnerWorkspace(
      t,
      owner,
      config,
      'testDir: ".", testMatch: "focus.spec.ts", testIgnore: [], webServer: undefined, reporter: "list", projects: [{}]',
      "focus.spec.ts",
      'import { test } from "@playwright/test"\ntest.only("synthetic focus", () => {})\n',
    )
    const result = runFixture(
      root,
      path.join(dependencies, "@playwright/test/cli.js"),
      ["test", "--config", "runner.config.mjs"],
    )
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /focused with '\.only' is not allowed/)
  })
}
