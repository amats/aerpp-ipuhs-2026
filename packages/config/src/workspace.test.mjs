import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  applicationEnvironment,
  assertNoAppEnvFiles,
} from "@aerpp/config/process"
import {
  checkEnvironment,
  environmentDirectory,
  generatedEnvironmentDirectory,
  generateEnvironment,
  initializeEnvironment as initializeTemplate,
  prepareApplicationRuntime,
} from "@aerpp/config/workspace"
import { adminSecrets } from "../test-support/credentials.mjs"
import { writeAutoSettings } from "./auto-settings.mjs"
import { decodeManualConfig, encodeManualConfig } from "./manual-config.mjs"

const PROJECTS = { test: "synthetic-test", production: "synthetic-production" }

test("the complete public template keeps cloud credentials out of local runtime", () => {
  const directory = environmentDirectory("example")
  checkEnvironment("example", directory)
  const { values } = prepareApplicationRuntime("example", directory)
  assert.deepEqual(Object.keys(values).sort(), ["support", "web"])
  const runtime = JSON.parse(values.support.SUPPORT_RUNTIME_JSON)
  assert.equal(runtime.mailMode, "sink")
  assert.equal(runtime.gmail, undefined)
  assert.equal(values.support.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8088")
  assert.equal(values.web.AUTHENTICATION_EMAIL_SENDER, undefined)
  assert.equal(values.web.GOOGLE_APPLICATION_CREDENTIALS, undefined)
  assert.equal(values.web.NEXTAUTH_SECRET, undefined)
  assert.equal(values.support.GOOGLE_APPLICATION_CREDENTIALS, undefined)
  assert.throws(
    () => prepareApplicationRuntime("example", directory, { apps: "admin" }),
    /unavailable/,
  )
})

test("local template sender examples reject credentials instead of silently ignoring them", () => {
  const directory = mkdtempSync(join(tmpdir(), "aerpp-example-sender-"))
  try {
    const config = JSON.parse(
      readFileSync(
        join(environmentDirectory("example"), "config.json"),
        "utf8",
      ),
    )
    for (const gmail of [
      { sender: "invalid" },
      { sender: "sender@example.invalid", clientSecret: "unexpected" },
    ]) {
      config.support.gmail = gmail
      writeFileSync(join(directory, "config.json"), JSON.stringify(config))
      assert.throws(
        () => prepareApplicationRuntime("example", directory),
        /only an illustrative sender/,
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
const webRequire = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
)
const nextRequire = createRequire(webRequire.resolve("next/package.json"))
const read = (directory, file) => {
  const value = JSON.parse(readFileSync(join(directory, file), "utf8"))
  return file === "config.json" ? decodeManualConfig(value) : value
}
const write = (directory, file, value) =>
  writeFileSync(
    join(directory, file),
    JSON.stringify(file === "config.json" ? encodeManualConfig(value) : value),
  )

function initializeEnvironment(name, directory, projects) {
  initializeTemplate(name, directory, projects)
  const config = read(directory, "config.json")
  write(directory, "config.json", config)
  writeAutoSettings(
    directory,
    { name, project: projects[name] },
    {
      adminUrl: "https://admin.example.com",
    },
  )
}

test("environment directories select test and production without path traversal", () => {
  assert.equal(
    environmentDirectory("test", "/workspace"),
    "/workspace/config/test",
  )
  assert.equal(
    environmentDirectory("production", "/workspace"),
    "/workspace/config/production",
  )
  assert.throws(() => environmentDirectory("../production", "/workspace"))
})

test("Admin loads with the shared cutoff independently of Support runtime and secrets", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-admin-selection-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    write(directory, "config.json", {
      version: 1,
      shared: {
        PARTICIPANT_API_SERVER_ID: "synthetic-server",
      },
      admin: { NEXTAUTH_SECRET: { secret: "NEXTAUTH_SECRET" } },
      support: {
        access: {
          notBefore: "1970-01-01T00:00:00Z",
          expiresAt: "2099-01-01T00:00:00Z",
          backendStopsAt: "2099-12-31T00:00:00Z",
          revoked: false,
        },
      },
    })
    write(directory, "secret.json", {
      ...adminSecrets(PROJECTS.test),
      NEXTAUTH_SECRET: "selected-admin-secret",
    })
    writeFileSync(join(directory, "broken.json"), "invalid-unused-manifest")
    const { values } = prepareApplicationRuntime("test", directory, {
      projects: { test: PROJECTS.test },
      apps: "admin",
    })
    assert.deepEqual(Object.keys(values), ["admin"])
    assert.equal(values.admin.NEXTAUTH_SECRET, "selected-admin-secret")
    assert.equal(
      values.admin.SESSION_SEAL_PASSWORD,
      adminSecrets(PROJECTS.test).SESSION_SEAL_PASSWORD,
    )
    assert.equal(values.admin.SUPPORT_API_CREDENTIAL, undefined)
    assert.equal(
      values.admin.IDENTIFIER_HASH_SECRET,
      adminSecrets(PROJECTS.test).IDENTIFIER_HASH_SECRET,
    )
    assert.equal(values.admin.GCP_PROJECT_ID, PROJECTS.test)
    assert.equal(
      values.admin.SUPPORT_RECEPTION_EXPIRES_AT,
      "2099-01-01T00:00:00Z",
    )
    assert.equal(values.admin.SUPPORT_BACKEND_STOPS_AT, "2099-12-31T00:00:00Z")
    const output = join(directory, "generated")
    const config = read(directory, "config.json")
    const access = config.support.access
    for (const invalidAccess of [undefined, { ...access, revoked: "false" }]) {
      config.support.access = invalidAccess
      write(directory, "config.json", config)
      assert.throws(
        () =>
          prepareApplicationRuntime("test", directory, {
            projects: PROJECTS,
            apps: "admin",
          }),
        /support.access/,
      )
    }
    config.support.access = access
    write(directory, "secret.json", {
      ...adminSecrets(PROJECTS.test),
      NEXTAUTH_SECRET: "synthetic-updated-secret",
    })
    write(directory, "config.json", config)
    generateEnvironment(
      "test",
      directory,
      { test: PROJECTS.test },
      output,
      "admin",
    )
    assert.deepEqual(readdirSync(output), ["admin.json"])
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("initialization creates only editable JSON files and never overwrites secrets", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-json-config-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    initializeEnvironment("test", directory, PROJECTS)
    const secrets = read(directory, "secret.json")
    secrets.SUPPORT_WEB_API_CREDENTIAL = " existing-key "
    write(directory, "secret.json", secrets)
    initializeEnvironment("test", directory, PROJECTS)
    assert.deepEqual(readdirSync(directory).sort(), [
      "config.json",
      "secret.json",
    ])
    assert.equal(
      read(directory, "secret.json").SUPPORT_WEB_API_CREDENTIAL,
      " existing-key ",
    )
    assert.equal(
      generatedEnvironmentDirectory("test", "/workspace"),
      "/workspace/generated/test",
    )
    assert.equal(
      generatedEnvironmentDirectory("production", "/workspace"),
      "/workspace/generated/production",
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("a selected app resolves only its secrets and launches without ambient project or credentials", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-provider-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    initializeEnvironment("test", directory, PROJECTS)
    const config = read(directory, "config.json")
    config.support.access.expiresAt = "2099-01-01T00:00:00Z"
    write(directory, "config.json", config)
    write(directory, "secret.json", {
      ...adminSecrets(PROJECTS.test),
      NEXTAUTH_SECRET: "selected-key",
    })
    const { values } = prepareApplicationRuntime("test", directory, {
      projects: PROJECTS,
      apps: "admin",
    })
    const child = applicationEnvironment(values.admin, {
      PATH: "/bin",
      NEXTAUTH_SECRET: "stale-key",
      GOOGLE_CLOUD_PROJECT: PROJECTS.production,
      NODE_OPTIONS: "--require untrusted",
      PRIVATE_UNRELATED: "unrelated-secret",
      SUPPORT_RUNTIME_JSON: "stale-runtime",
    })
    assert.equal(child.NEXTAUTH_SECRET, "selected-key")
    assert.equal(child.GOOGLE_CLOUD_PROJECT, "")
    assert.equal(child.NODE_OPTIONS, "")
    assert.equal(child.PRIVATE_UNRELATED, undefined)
    assert.equal(child.SUPPORT_RUNTIME_JSON, "")
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("managed Next.js launch rejects competing env files and preserves literal secret values", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-next-env-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(
      join(directory, ".env.local"),
      "SUPPORT_API_CREDENTIAL=stale-key\nNEXTAUTH_SECRET=unrelated-secret\n",
    )
    assert.throws(
      () => assertNoAppEnvFiles(directory),
      /move required settings to the shared profile/,
    )
    rmSync(join(directory, ".env.local"))
    for (const name of [".env.example", ".env.ipuhs", ".env.local.example"]) {
      writeFileSync(join(directory, name), "SYNTHETIC=value")
      assert.throws(
        () => assertNoAppEnvFiles(directory),
        /move required settings to the shared profile/,
      )
      rmSync(join(directory, name))
    }
    assert.doesNotThrow(() => assertNoAppEnvFiles(directory))
    const value = "synthetic $LITERAL 'quotes' \\n\nnewline"
    const env = applicationEnvironment({ SUPPORT_API_CREDENTIAL: value })
    env.NODE_ENV = "development"
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from "node:assert/strict"
      import { createRequire } from "node:module"
      const require = createRequire(${JSON.stringify(nextRequire.resolve("@next/env"))})
      const { loadEnvConfig } = require(${JSON.stringify(nextRequire.resolve("@next/env"))})
      loadEnvConfig(${JSON.stringify(directory)}, true, { info() {}, error() {} })
      assert.equal(process.env.SUPPORT_API_CREDENTIAL, ${JSON.stringify(value)})
      assert.equal(process.env.NEXTAUTH_SECRET, "")
    `,
      ],
      { env, encoding: "utf8" },
    )
    assert.equal(
      result.status,
      0,
      result.stderr || "Next.js environment isolation failed",
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
