import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { applicationEnvironment } from "@aerpp/config/process"
import {
  adminSecrets,
  serviceCredential,
} from "../../packages/config/test-support/credentials.mjs"
import { createWorkspace } from "../checks/test-support/workspace.mjs"
import { deriveInfrastructure } from "./sync-environment.mjs"

function syncFixture(t, environment = "test") {
  const { root, write } = createWorkspace(t, "aerpp-sync-")
  const source = fileURLToPath(new URL("../..", import.meta.url))
  for (const directory of ["scripts", "packages/config"])
    cpSync(join(source, directory), join(root, directory), {
      recursive: true,
      filter: (file) => !["node_modules", "generated"].includes(basename(file)),
    })
  write("node_modules/@aerpp/.placeholder", "")
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
  const project = `synthetic-${environment}`
  write(`config/${environment}/config.json`, {
    version: 1,
    projectId: project,
    infrastructure: {
      region: "asia-northeast1",
      operatorAccount: "operator@example.invalid",
    },
  })
  const labels = {
    "aerpp-component": "admin",
    "aerpp-environment": environment,
  }
  const service = {
    metadata: { name: "aerpp-admin" },
    spec: { template: { metadata: { labels } } },
  }
  const autoFile = join(root, `generated/${environment}/auto.json`)
  const consoleFile = join(root, `config/${environment}/console-settings.json`)
  write(`generated/${environment}/auto.json`, {
    version: 1,
    environment,
    project,
  })
  write(`config/${environment}/console-settings.json`, {
    retained: "synthetic prior settings",
  })
  write(
    "bin/gcloud",
    `#!${process.execPath}
const assert = require("node:assert/strict")
const fs = require("node:fs")
const args = process.argv.slice(2)
assert(args.includes(${JSON.stringify(`--project=${project}`)}))
assert.equal(process.env.CLOUDSDK_CORE_ACCOUNT, "operator@example.invalid")
fs.appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n")
if (args[0] === "projects") process.stdout.write("123456789000")
else {
  assert.equal(args[0], "run")
  assert.equal(args[1], "services")
  assert.equal(args[2], "list")
  const services = JSON.parse(fs.readFileSync("services.json", "utf8"))
  const format = args.find(arg => arg.startsWith("--format="))
  if (!format.includes("spec.template.metadata.labels"))
    for (const service of services) delete service.spec
  process.stdout.write(JSON.stringify(services))
}
`,
  )
  chmodSync(join(root, "bin/gcloud"), 0o700)
  const run = (services) => {
    write("services.json", services)
    return spawnSync(
      process.execPath,
      [
        join(root, "scripts/config/sync-environment.mjs"),
        environment,
        "--refresh",
      ],
      {
        cwd: root,
        env: applicationEnvironment({
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
        }),
        encoding: "utf8",
        timeout: 10_000,
      },
    )
  }
  return { root, write, service, run, autoFile, consoleFile }
}

for (const environment of ["test", "production"]) {
  test(`refresh accepts Terraform template ownership without service labels in ${environment}`, (t) => {
    const f = syncFixture(t, environment)
    const result = f.run([f.service])
    assert.equal(result.status, 0, result.stderr)
    const auto = JSON.parse(readFileSync(f.autoFile, "utf8"))
    assert.equal(auto.environment, environment)
    assert.equal(auto.cloudStatus.verified, true)
    assert.equal(auto.cloudStatus.serviceExists, true)
    assert.equal(
      JSON.parse(readFileSync(f.consoleFile, "utf8")).admin.cloudRun.serviceUrl,
      auto.adminUrl,
    )
  })
}

test("refresh rejects missing, cross-environment and conflicting ownership before replacing metadata", (t) => {
  const f = syncFixture(t)
  const auto = readFileSync(f.autoFile, "utf8")
  const consoleSettings = readFileSync(f.consoleFile, "utf8")
  const labels = f.service.spec.template.metadata.labels
  for (const service of [
    { metadata: { name: "aerpp-admin", labels } },
    {
      ...f.service,
      spec: {
        template: {
          metadata: {
            labels: { ...labels, "aerpp-environment": "production" },
          },
        },
      },
    },
    {
      ...f.service,
      metadata: {
        name: "aerpp-admin",
        labels: { "aerpp-component": "support" },
      },
    },
  ]) {
    const result = f.run([service])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not owned by this Admin deployment workflow/)
    assert.equal(readFileSync(f.autoFile, "utf8"), auto)
    assert.equal(readFileSync(f.consoleFile, "utf8"), consoleSettings)
  }
})

test("refresh can generate initial Console settings before the Admin service exists", (t) => {
  const f = syncFixture(t)
  const result = f.run([])
  assert.equal(result.status, 0, result.stderr)
  const auto = JSON.parse(readFileSync(f.autoFile, "utf8"))
  assert.equal(auto.cloudStatus.serviceExists, false)
  assert.equal(new URL(auto.adminUrl).protocol, "https:")
})

test("Terraform identities need no manual account names and bind existing credentials to the project", () => {
  const target = { name: "test", project: "synthetic-test" }
  const directory = mkdtempSync(join(tmpdir(), "aerpp-infrastructure-"))
  try {
    const config = {
      infrastructure: { maxInstances: 4, region: "asia-northeast1" },
    }
    assert.equal(
      deriveInfrastructure(config, target).deployment.maxInstances,
      4,
    )
    assert.equal(
      deriveInfrastructure(config, target).deployment.serviceAccountId,
      "aerpp-admin-runtime",
    )
    for (const name of ["adminServiceAccount", "loggingServiceAccount"])
      assert.throws(() =>
        deriveInfrastructure(
          { infrastructure: { [name]: "manual-name" } },
          target,
        ),
      )
    writeFileSync(
      join(directory, "secret.json"),
      JSON.stringify({
        ...adminSecrets(target.project),
        LOGGING_SERVICE_ACCOUNT_JSON: serviceCredential(
          target.project,
          "logging",
        ),
      }),
    )
    const identities = deriveInfrastructure(
      config,
      target,
      directory,
    ).serviceAccounts
    assert.equal(
      identities.localAdmin,
      `aerpp-admin-local@${target.project}.iam.gserviceaccount.com`,
    )
    assert.equal(
      identities.logging,
      `logging-reader@${target.project}.iam.gserviceaccount.com`,
    )
    assert.throws(() =>
      deriveInfrastructure(
        config,
        { name: "production", project: "synthetic-production" },
        directory,
      ),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
