import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { main } from "./run-environment.mjs"

function freshLauncherFixture(t) {
  const source = fileURLToPath(new URL("../..", import.meta.url))
  const root = mkdtempSync(join(tmpdir(), "aerpp-fresh-launch-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const file of [
    "scripts/config/run-environment.mjs",
    "scripts/shared/delivery.mjs",
    "scripts/licenses/stage-license-notices.mjs",
  ]) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    copyFileSync(join(source, file), join(root, file))
  }
  cpSync(join(source, "packages/config"), join(root, "packages/config"), {
    recursive: true,
    filter: (file) => basename(file) !== "node_modules",
  })
  mkdirSync(join(root, "node_modules/@aerpp"), { recursive: true })
  symlinkSync(
    join(root, "packages/config"),
    join(root, "node_modules/@aerpp/config"),
    "dir",
  )
  symlinkSync(
    join(source, "packages/config/node_modules"),
    join(root, "packages/config/node_modules"),
    "dir",
  )
  cpSync(join(source, "config/example"), join(root, "config/example"), {
    recursive: true,
  })
  cpSync(join(source, "config/common"), join(root, "config/common"), {
    recursive: true,
  })
  mkdirSync(join(root, "docs/licenses"), { recursive: true })
  for (const file of [
    "LICENSE",
    "NOTICE",
    "docs/licenses/APACHE-2.0.txt",
    "docs/licenses/BSD-2-CLAUSE.txt",
    "docs/licenses/OFL-1.1.txt",
    "docs/licenses/HAI-DEF-TERMS.txt",
    "docs/licenses/HAI-DEF-PROHIBITED-USE.txt",
  ])
    copyFileSync(join(source, file), join(root, file))
  writeFileSync(join(root, "docs/licenses/npm-notices.json"), "[]\n")
  mkdirSync(join(root, "apps/web/node_modules/next/dist/bin"), {
    recursive: true,
  })
  writeFileSync(
    join(root, "apps/web/node_modules/next/dist/bin/next"),
    `
    const assert = require("node:assert/strict")
    const fs = require("node:fs")
    for (const file of ["LICENSE", "NOTICE", "dependencies.json", "HAI-DEF-TERMS.txt"])
      assert.ok(fs.readFileSync("generated/licenses/" + file).length > 0)
    fs.writeFileSync("next-started.txt", process.argv[2])
  `,
  )
  return {
    root,
    run: (operation) =>
      spawnSync(
        process.execPath,
        [
          join(root, "scripts/config/run-environment.mjs"),
          "example",
          "web",
          operation,
        ],
        { cwd: root, encoding: "utf8", env: {} },
      ),
  }
}

for (const operation of ["dev", "build"]) {
  test(`fresh managed Web ${operation} stages notices before starting Next.js`, (t) => {
    const fixture = freshLauncherFixture(t)
    assert.equal(existsSync(join(fixture.root, "apps/web/generated")), false)
    const result = fixture.run(operation)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      readFileSync(join(fixture.root, "apps/web/next-started.txt"), "utf8"),
      operation,
    )
    assert.equal(
      readFileSync(
        join(fixture.root, "apps/web/generated/licenses/NOTICE"),
        "utf8",
      ),
      readFileSync(join(fixture.root, "NOTICE"), "utf8"),
    )
  })
}

test("managed startup stops before Next.js when canonical notices are missing", (t) => {
  const fixture = freshLauncherFixture(t)
  rmSync(join(fixture.root, "NOTICE"))
  const result = fixture.run("dev")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /NOTICE/)
  assert.equal(
    existsSync(join(fixture.root, "apps/web/next-started.txt")),
    false,
  )
})

test("VS Code uses managed test cloud for Web/Admin", () => {
  const tasks = JSON.parse(
    readFileSync(new URL("../../.vscode/tasks.json", import.meta.url), "utf8"),
  ).tasks
  const { configurations: launches } = JSON.parse(
    readFileSync(new URL("../../.vscode/launch.json", import.meta.url), "utf8"),
  )
  assert.equal(launches.length, 2)
  assert.ok(launches.every((launch) => launch.type === "node"))
  for (const [app, target, port] of [
    ["web", "test", 9230],
    ["admin", "test", 9231],
  ]) {
    const task = tasks.find((task) => task.label === `debug:${app}`)
    assert.ok(task, `Missing debug task for ${app}`)
    assert.equal(task.command, "pnpm")
    assert.deepEqual(task.args.slice(0, 5), [
      "run",
      "env:run",
      target,
      app,
      "dev",
    ])
    const launch = launches.find(
      (launch) => launch.preLaunchTask === task.label,
    )
    assert.ok(task.args.includes(`--inspect=127.0.0.1:${port}`))
    assert.ok(launch, `Missing server debug configuration for ${app}`)
    assert.equal(launch.type, "node")
    assert.equal(launch.request, "attach")
    assert.equal(launch.port, port)
    assert.equal(launch.address, "127.0.0.1")
    if (app === "admin") assert.equal(launch.autoAttachChildProcesses, false)
  }
})

test("Functions manual debugging rejects cloud selection before reading private inputs", async () => {
  assert.equal(await main(["test", "functions", "dev"]), 1)
  assert.equal(await main(["production", "functions", "dev"]), 1)
})

test("support launcher refuses cloud starts and arbitrary arguments before reading profiles", async () => {
  assert.equal(await main(["test", "support", "start"]), 1)
  assert.equal(await main(["production", "support", "start"]), 1)
  assert.equal(
    await main(["example", "support", "start", "--inspect=0.0.0.0"]),
    1,
  )
})
