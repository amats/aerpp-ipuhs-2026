import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { REQUIRED_CLOUD_APIS } from "../cloud/project-services.mjs"
import { main, setupEnvironment } from "./setup-environment.mjs"

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "aerpp-initial-setup-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = resolve(root, "config/test")
  mkdirSync(directory, { recursive: true })
  const target = { name: "test", project: "synthetic-test" }
  const config = {
    version: 1,
    projectId: target.project,
    infrastructure: {
      region: "asia-northeast1",
      operatorAccount: "operator@synthetic.invalid",
    },
    support: { admissionOpen: false, maintenanceEnabled: false },
  }
  const saveConfig = () =>
    writeFileSync(resolve(directory, "config.json"), JSON.stringify(config))
  saveConfig()
  writeFileSync(
    resolve(directory, "secret.json"),
    JSON.stringify({
      LOGGING_SERVICE_ACCOUNT_JSON: "YOUR_LOGGING_SERVICE_ACCOUNT_JSON",
    }),
  )
  const calls = []
  const deps = {
    directory: () => directory,
    target: () => target,
    runCommand: (command, args) => calls.push({ command, args }),
    execute: (project, args) => {
      assert.equal(project, target.project)
      calls.push({ project, args })
      if (args[0] === "projects")
        return JSON.stringify({ lifecycleState: "ACTIVE" })
      if (args[0] === "billing") return JSON.stringify({ billingEnabled: true })
      assert.deepEqual(args, ["services", "enable", ...REQUIRED_CLOUD_APIS])
      return ""
    },
  }
  return { directory, target, config, saveConfig, calls, deps }
}

test("init creates private cloud inputs without cloud calls and refuses existing inputs", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "aerpp-setup-init-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = resolve(root, "config/production")
  const deps = {
    directory: () => directory,
    execute: () => assert.fail("init must not use cloud"),
    runCommand: () => assert.fail("init must not launch cloud commands"),
  }
  setupEnvironment(["production", "init", "synthetic-production"], deps)
  const path = resolve(directory, "config.json")
  const bytes = readFileSync(path, "utf8")
  const config = JSON.parse(bytes)
  assert.equal(config.projectId, "synthetic-production")
  assert.equal(config.web.debugPagesEnabled, "false")
  assert.equal(config.support.admissionOpen, false)
  assert.equal(config.support.maintenanceEnabled, false)
  assert.equal(config.support.local, undefined)
  assert(existsSync(resolve(directory, "secret.json")))
  assert.throws(
    () => setupEnvironment(["production", "init", "other-project"], deps),
    /already exist/,
  )
  assert.equal(readFileSync(path, "utf8"), bytes)
})

test("plan checks project and billing before enabling APIs, then saves a plan without applying", (t) => {
  const f = fixture(t)
  assert.deepEqual(setupEnvironment(["test", "plan"], f.deps), {
    phase: "plan",
    reviewRequired: true,
  })
  assert.deepEqual(
    f.calls.slice(0, 3).map((call) => call.args[0]),
    ["projects", "billing", "services"],
  )
  assert.deepEqual(
    f.calls.slice(3).map((call) => [call.command, ...call.args]),
    [
      ["pnpm", "run", "env:sync", "test", "--refresh"],
      ["pnpm", "run", "infra:terraform", "test", "bootstrap"],
      ["pnpm", "run", "infra:terraform", "test", "plan"],
    ],
  )
})

test("apply runs the reviewed plan, refreshes Console settings, then initializes/uploads secrets", (t) => {
  const f = fixture(t)
  f.deps.execute = () =>
    assert.fail(
      "apply delegates selected cloud operations to maintained commands",
    )
  setupEnvironment(["test", "apply"], f.deps)
  assert.deepEqual(
    f.calls.map((call) => call.args),
    [
      ["run", "infra:terraform", "test", "apply"],
      ["run", "env:sync", "test", "--refresh"],
      ["run", "env:prepare-secrets", "test", "--upload"],
    ],
  )
  f.calls.length = 0
  setupEnvironment(["test", "apply", "--replace-secrets"], f.deps)
  assert.deepEqual(f.calls.at(-1).args, [
    "run",
    "env:prepare-secrets",
    "test",
    "--upload",
    "--replace",
  ])
})

test("disabled billing and failed phases stop subsequent writes", (t) => {
  const f = fixture(t)
  for (const billingEnabled of [false, "true", undefined]) {
    const calls = []
    assert.throws(
      () =>
        setupEnvironment(["test", "plan"], {
          ...f.deps,
          execute: (_project, args) => {
            calls.push(args[0])
            return JSON.stringify(
              args[0] === "projects"
                ? { lifecycleState: "ACTIVE" }
                : { billingEnabled },
            )
          },
        }),
      /Enable billing/,
    )
    assert.deepEqual(calls, ["projects", "billing"])
  }
  const commands = []
  assert.throws(
    () =>
      setupEnvironment(["test", "apply"], {
        ...f.deps,
        runCommand: (_command, args) => {
          commands.push(args)
          throw new Error("Synthetic phase failure")
        },
      }),
    /Synthetic phase failure/,
  )
  assert.equal(commands.length, 1)
})

test("cloud setup rejects incomplete configurations and conflicting targets before cloud access", (t) => {
  const f = fixture(t)
  f.deps.execute = () =>
    assert.fail("invalid configuration must not access cloud")
  f.config.support.admissionOpen = "false"
  f.saveConfig()
  assert.throws(
    () => setupEnvironment(["test", "plan"], f.deps),
    /closed admission/,
  )
  f.config.support.admissionOpen = false
  f.config.infrastructure.operatorAccount = "operator@example.invalid"
  f.saveConfig()
  assert.throws(
    () => setupEnvironment(["test", "plan"], f.deps),
    /operatorAccount/,
  )
  f.config.projectId = "other-project"
  f.saveConfig()
  assert.throws(
    () => setupEnvironment(["test", "apply"], f.deps),
    /target mismatch/,
  )
})

test("invalid arguments and help never initialize inputs or invoke tools", () => {
  const dependencies = {
    directory: () =>
      assert.fail("invalid args must not resolve private inputs"),
  }
  for (const args of [
    ["example", "plan"],
    ["test", "delete"],
    ["test", "init"],
    ["test", "plan", "--replace-secrets"],
    ["test", "apply", "--unknown"],
  ])
    assert.throws(() => setupEnvironment(args, dependencies))
  assert.doesNotThrow(() => main(["--help"]))
})

test("check validates consumers then refreshes Gmail without provisioning", (t) => {
  const f = fixture(t)
  f.deps.execute = () => assert.fail("check must not provision cloud resources")
  assert.deepEqual(setupEnvironment(["test", "check"], f.deps), {
    phase: "check",
    credentialsChecked: true,
  })
  assert.deepEqual(
    f.calls.map((call) => call.args),
    [
      ["run", "env:check", "test"],
      ["run", "support:check-gmail", "test"],
    ],
  )
  const calls = []
  assert.throws(
    () =>
      setupEnvironment(["test", "check"], {
        ...f.deps,
        runCommand: (_command, args) => {
          calls.push(args)
          throw new Error("Synthetic invalid credentials")
        },
      }),
    /Synthetic invalid credentials/,
  )
  assert.equal(calls.length, 1)
  assert.throws(() => setupEnvironment(["test", "check", "--upload"], f.deps))
})
