import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { executeTerraformOperation } from "./execute.mjs"

test("plan and apply preserve reviewed bytes, serial execution and applied output projection", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "aerpp-terraform-operation-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const configurationDirectory = resolve(root, "config/test")
  const directory = resolve(root, "generated/test/support-terraform")
  mkdirSync(configurationDirectory, { recursive: true })
  mkdirSync(directory, { recursive: true })
  const project = "synthetic-test"
  const region = "asia-northeast1"
  const foundation = {
    version: 1,
    project,
    region,
    repository: `projects/${project}/locations/${region}/repositories/support-images`,
    runtimeServiceAccount: `support-runtime@${project}.iam.gserviceaccount.com`,
    schedulerServiceAccount: `support-scheduler@${project}.iam.gserviceaccount.com`,
    gmailSecretIds: {
      clientSecret: "SUPPORT_GMAIL_CLIENT_SECRET",
      refreshToken: "SUPPORT_GMAIL_REFRESH_TOKEN",
    },
  }
  const plan = {
    variables: { project_id: { value: project }, region: { value: region } },
    resource_changes: [],
  }
  const context = {
    project,
    region,
    directory,
    configurationDirectory,
    environment: "test",
    target: { name: "test", project },
    moduleDirectory: root,
    sourceFingerprint: "synthetic-source",
    action: "plan",
    metadata: { projectNumber: "123456" },
    inputs: {},
    bucket: "synthetic-backend",
  }
  const calls = []
  const runCommand = (_tool, args, options) => {
    assert.equal(args[0], `-chdir=${root}`)
    assert.equal(options.env.TF_DATA_DIR, resolve(directory, ".terraform"))
    const [, command] = args
    calls.push(command)
    if (command === "plan")
      writeFileSync(
        args.find((arg) => arg.startsWith("-out=")).slice(5),
        "synthetic-plan",
      )
    if (command === "show") return JSON.stringify(plan)
    if (command === "apply") {
      assert(args.includes("-parallelism=1"))
      assert.equal(readFileSync(args.at(-1), "utf8"), "synthetic-plan")
    }
    if (command === "output")
      return JSON.stringify({
        support_foundation: { sensitive: false, value: foundation },
      })
    return ""
  }
  executeTerraformOperation(context, {}, { runCommand })
  assert.deepEqual(calls, ["init", "validate", "plan", "show"])
  calls.length = 0
  executeTerraformOperation({ ...context, action: "apply" }, {}, { runCommand })
  assert.deepEqual(calls, ["init", "validate", "show", "apply", "output"])
  assert.equal(
    JSON.parse(readFileSync(resolve(directory, "applied.json")))
      .sourceFingerprint,
    context.sourceFingerprint,
  )
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(directory, "outputs.json"))).foundation,
    foundation,
  )
})
