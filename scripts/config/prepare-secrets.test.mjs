import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { writeSupportTerraformSettings } from "@aerpp/config/auto-settings"
import { ROOT } from "@aerpp/config/workspace"
import { main, prepareApplicationSecrets } from "./prepare-secrets.mjs"

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "aerpp-secret-setup-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = resolve(root, "config/test")
  const output = resolve(root, "generated/test")
  mkdirSync(directory, { recursive: true })
  mkdirSync(output, { recursive: true })
  const target = { name: "test", project: "synthetic-test" }
  const config = {
    projectId: target.project,
    infrastructure: { region: "asia-northeast1" },
    support: { admissionOpen: false, maintenanceEnabled: false },
  }
  const file = resolve(directory, "secret.json")
  const secrets = JSON.parse(
    readFileSync(resolve(ROOT, "config/example/secret.json"), "utf8"),
  )
  const saveConfig = () =>
    writeFileSync(resolve(directory, "config.json"), JSON.stringify(config))
  saveConfig()
  writeFileSync(file, JSON.stringify(secrets))
  const read = () => JSON.parse(readFileSync(file, "utf8"))
  const prepare = (options) =>
    prepareApplicationSecrets(target, directory, output, {
      execute: (_project, args) => {
        assert.equal(args[0], "run")
        return "[]"
      },
      ...options,
    })
  const foundation = () =>
    writeSupportTerraformSettings(directory, target, {
      version: 1,
      project: target.project,
      region: config.infrastructure.region,
      repository: `projects/${target.project}/locations/asia-northeast1/repositories/aerpp-support`,
      runtimeServiceAccount: `aerpp-support-runtime@${target.project}.iam.gserviceaccount.com`,
      schedulerServiceAccount: `aerpp-support-scheduler@${target.project}.iam.gserviceaccount.com`,
      gmailSecretIds: {
        clientSecret: "SUPPORT_GMAIL_CLIENT_SECRET",
        refreshToken: "SUPPORT_GMAIL_REFRESH_TOKEN",
      },
    })
  return {
    directory,
    output,
    target,
    config,
    secrets,
    file,
    read,
    prepare,
    saveConfig,
    foundation,
  }
}

test("initial setup replaces public examples with independent keys and preserves manual credentials", (t) => {
  const f = fixture(t)
  const result = f.prepare()
  assert.equal(result.changed.length, 5)
  const values = f.read()
  for (const key of result.changed) {
    const value = values[key].split(".").at(-1)
    assert.match(value, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(Buffer.from(value, "base64url").length, 32)
    assert.notEqual(values[key], f.secrets[key])
  }
  assert.equal(new Set(result.changed.map((key) => values[key])).size, 5)
  assert.match(values.SUPPORT_WEB_API_CREDENTIAL, /^web-test\./)
  for (const key of Object.keys(f.secrets).filter(
    (key) => !result.changed.includes(key),
  ))
    assert.deepEqual(values[key], f.secrets[key])
  assert.equal(statSync(f.file).mode & 0o777, 0o600)
  const bytes = readFileSync(f.file, "utf8")
  assert.deepEqual(f.prepare(), { changed: [], versions: {} })
  assert.equal(readFileSync(f.file, "utf8"), bytes)
})

test("existing literal values remain exact unless replacement is explicit", (t) => {
  const f = fixture(t)
  f.prepare()
  const values = f.read()
  values.NEXTAUTH_SECRET = "literal $VALUE\nwith trailing space "
  writeFileSync(f.file, JSON.stringify(values))
  assert.deepEqual(f.prepare().changed, [])
  assert.equal(f.read().NEXTAUTH_SECRET, values.NEXTAUTH_SECRET)
  const configBytes = readFileSync(resolve(f.directory, "config.json"), "utf8")
  const result = f.prepare({ replace: true })
  assert.equal(result.changed.length, 5)
  for (const key of result.changed) assert.notEqual(f.read()[key], values[key])
  assert.equal(
    readFileSync(resolve(f.directory, "config.json"), "utf8"),
    configBytes,
  )
})

test("initialization rejects admission, maintenance and deployment conflicts before writing", (t) => {
  const f = fixture(t)
  const before = readFileSync(f.file, "utf8")
  for (const key of ["admissionOpen", "maintenanceEnabled"]) {
    for (const invalid of [true, "false", undefined]) {
      f.config.support[key] = invalid
      f.saveConfig()
      assert.throws(() => f.prepare(), /closed admission and maintenance/)
      assert.equal(readFileSync(f.file, "utf8"), before)
    }
    f.config.support[key] = false
  }
  f.saveConfig()
  writeFileSync(resolve(f.output, "support-deployment.json"), "{}")
  assert.throws(() => f.prepare({ replace: true }), /prepared or deployed/)
  assert.equal(readFileSync(f.file, "utf8"), before)
})

test("uploads reuse receipts after a partial failure without replacing locally generated keys", (t) => {
  const f = fixture(t)
  f.foundation()
  const stored = new Map()
  let fail = true
  const execute = (project, args, options) => {
    assert.equal(project, f.target.project)
    assert(!args.includes("access"))
    if (args[0] === "run") return "[]"
    const secret = args[3]
    if (args[2] === "list") return JSON.stringify(stored.get(secret) ?? [])
    assert.equal(args[2], "add")
    if (fail && stored.size === 1) throw new Error("Synthetic upload failure")
    assert(Object.values(f.read()).includes(options.input))
    const versions = stored.get(secret) ?? []
    const metadata = {
      name: `projects/123456/secrets/${secret}/versions/${versions.length + 1}`,
      state: "ENABLED",
      createTime: "2026-10-10T00:00:00Z",
    }
    stored.set(secret, [...versions, metadata])
    return JSON.stringify(metadata)
  }
  assert.throws(
    () => f.prepare({ upload: true, execute }),
    /Synthetic upload failure/,
  )
  const bytes = readFileSync(f.file, "utf8")
  fail = false
  const result = f.prepare({ upload: true, execute })
  assert.deepEqual(result.changed, [])
  assert.equal(Object.keys(result.versions).length, 3)
  assert.equal(readFileSync(f.file, "utf8"), bytes)
  assert([...stored.values()].every((versions) => versions.length === 1))
  for (const secret of stored.keys()) {
    const receipt = readFileSync(
      resolve(f.output, `secret-version-${secret}.json`),
      "utf8",
    )
    for (const key of Object.keys(result.versions))
      assert(!receipt.includes(f.read()[key]))
  }
})

test("cloud upload rejects missing foundation, live services and mismatched projects without changing inputs", (t) => {
  const f = fixture(t)
  const bytes = readFileSync(f.file, "utf8")
  assert.throws(
    () => f.prepare({ upload: true }),
    /Apply the selected Terraform foundation/,
  )
  f.foundation()
  assert.throws(
    () =>
      f.prepare({
        upload: true,
        execute: () =>
          JSON.stringify([{ metadata: { name: "aerpp-support" } }]),
      }),
    /undeployed application services/,
  )
  f.config.projectId = "other-project"
  f.saveConfig()
  assert.throws(() => f.prepare(), /target mismatch/)
  assert.equal(readFileSync(f.file, "utf8"), bytes)
})

test("CLI rejects local targets, duplicate flags and unknown flags before loading private inputs", () => {
  assert.throws(() => main(["example"]), /test or production/)
  for (const flags of [["--replace", "--replace"], ["--unknown"]])
    assert.throws(() => main(["test", ...flags]), /Usage/)
})
