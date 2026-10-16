import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  readAutoSettings,
  writeAutoSettings,
  writeSupportTerraformSettings,
} from "./auto-settings.mjs"
import {
  deriveSupportTerraformInputs,
  parseSupportTerraformOutputs,
} from "./terraform.mjs"

const TARGET = { name: "test", project: "synthetic-test-project" }
const REGION = "asia-northeast1"
const FOUNDATION = {
  version: 1,
  project: TARGET.project,
  region: REGION,
  repository: `projects/${TARGET.project}/locations/${REGION}/repositories/support-images`,
  runtimeServiceAccount: `support-runtime@${TARGET.project}.iam.gserviceaccount.com`,
  schedulerServiceAccount: `support-scheduler@${TARGET.project}.iam.gserviceaccount.com`,
  gmailSecretIds: {
    clientSecret: "SUPPORT_GMAIL_CLIENT_SECRET",
    refreshToken: "SUPPORT_GMAIL_REFRESH_TOKEN",
  },
}
const output = (value = FOUNDATION) => ({
  support_foundation: { sensitive: false, value },
})

test("Terraform projection has a strict allowlist and no secret or automatic inputs", () => {
  const config = {
    version: 1,
    infrastructure: { region: REGION },
    shared: { password: "must-not-export" },
    auto: { region: "us-central1" },
  }
  assert.deepEqual(deriveSupportTerraformInputs(config, TARGET), {
    project_id: TARGET.project,
    environment: "test",
    region: REGION,
  })
  for (const target of [
    { ...TARGET, name: "invalid" },
    { ...TARGET, project: "demo-test" },
  ])
    assert.throws(() => deriveSupportTerraformInputs(config, target))
  assert.throws(() => deriveSupportTerraformInputs({ version: 1 }, TARGET))
  assert.throws(() =>
    deriveSupportTerraformInputs(
      { ...config, infrastructure: { region: "invalid" } },
      TARGET,
    ),
  )
})

test("Terraform output rejects cross-target identities, unknown fields and sensitive outputs", () => {
  assert.deepEqual(
    parseSupportTerraformOutputs(output(), TARGET, REGION),
    FOUNDATION,
  )
  for (const patch of [
    { project: "another-project" },
    { region: "us-central1" },
    {
      runtimeServiceAccount:
        "support-runtime@another-project.iam.gserviceaccount.com",
    },
    {
      repository:
        "projects/another-project/locations/asia-northeast1/repositories/support-images",
    },
    { schedulerServiceAccount: FOUNDATION.runtimeServiceAccount },
    { baseUrl: "https://unowned.example.com" },
    { tokenKey: "must-not-export" },
    {
      gmailSecretIds: {
        ...FOUNDATION.gmailSecretIds,
        refreshToken: "literal-secret",
      },
    },
  ])
    assert.throws(() =>
      parseSupportTerraformOutputs(
        output({ ...FOUNDATION, ...patch }),
        TARGET,
        REGION,
      ),
    )
  assert.throws(() =>
    parseSupportTerraformOutputs(
      { ...output(), extra: { value: "secret" } },
      TARGET,
      REGION,
    ),
  )
  assert.throws(() =>
    parseSupportTerraformOutputs(
      { support_foundation: { sensitive: true, value: FOUNDATION } },
      TARGET,
      REGION,
    ),
  )
})

test("Terraform and cloud metadata writers preserve each other and never alter manual or secret inputs", () => {
  const fixture = mkdtempSync(join(tmpdir(), "aerpp-terraform-config-"))
  const directory = join(fixture, "config", "test")
  mkdirSync(directory, { recursive: true })
  try {
    const config =
      '{"version":1,"infrastructure":{"region":"asia-northeast1"}}\n'
    const secret = ' {"SECRET":"literal $VALUE\\nbytes"} \n'
    writeFileSync(join(directory, "config.json"), config)
    writeFileSync(join(directory, "secret.json"), secret)
    writeAutoSettings(directory, TARGET, {
      adminUrl: "https://admin.example.com",
    })
    writeSupportTerraformSettings(directory, TARGET, FOUNDATION)
    writeAutoSettings(directory, TARGET, { projectNumber: "123456789012" })
    const auto = readAutoSettings(directory, TARGET)
    assert.equal(auto.adminUrl, "https://admin.example.com")
    assert.deepEqual(auto.terraform.support, FOUNDATION)
    assert.throws(
      () => writeAutoSettings(directory, TARGET, { terraform: undefined }),
      /must be written/,
    )
    assert.equal(readFileSync(join(directory, "config.json"), "utf8"), config)
    assert.equal(readFileSync(join(directory, "secret.json"), "utf8"), secret)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("monitoring notification email is explicit non-secret configuration", () => {
  const config = {
    version: 1,
    infrastructure: {
      region: REGION,
      monitoring: { notificationEmail: "alerts@example.invalid" },
    },
  }
  assert.deepEqual(deriveSupportTerraformInputs(config, TARGET).monitoring, {
    notification_email: "alerts@example.invalid",
  })
  for (const monitoring of [
    {},
    { notificationEmail: "invalid" },
    { notificationEmail: "alerts@example.invalid", secret: "must-not-export" },
  ])
    assert.throws(() =>
      deriveSupportTerraformInputs(
        { ...config, infrastructure: { region: REGION, monitoring } },
        TARGET,
      ),
    )
})

test("existing Firestore identity rejects extra settings and invalid locations", () => {
  const make = (firestore) => ({
    version: 1,
    infrastructure: { region: REGION, firestore },
  })
  assert.deepEqual(
    deriveSupportTerraformInputs(make({ location: REGION }), TARGET).firestore,
    { location: REGION },
  )
  for (const value of [
    {},
    { location: "invalid location" },
    { location: REGION, credentials: "must-not-export" },
  ])
    assert.throws(() => deriveSupportTerraformInputs(make(value), TARGET))
})

test("existing index ownership is an explicit boolean opt-in", () => {
  const config = {
    version: 1,
    infrastructure: {
      region: REGION,
      firestore: { location: REGION, manageExistingIndexes: true },
    },
  }
  assert.equal(
    deriveSupportTerraformInputs(config, TARGET).firestore
      .manage_existing_indexes,
    true,
  )
  config.infrastructure.firestore.manageExistingIndexes = "true"
  assert.throws(() => deriveSupportTerraformInputs(config, TARGET))
})

test("daily backups require explicit bounded retention and never export unrelated settings", () => {
  const make = (firestore) => ({
    version: 1,
    infrastructure: {
      region: REGION,
      firestore: { location: REGION, ...firestore },
    },
  })
  for (const days of [1, 7, 30, 98])
    assert.deepEqual(
      deriveSupportTerraformInputs(
        make({ automaticBackups: true, backupRetentionDays: days }),
        TARGET,
      ).firestore,
      {
        location: REGION,
        automatic_backups: true,
        backup_retention_days: days,
      },
    )
  assert.equal(
    deriveSupportTerraformInputs(make({ automaticBackups: false }), TARGET)
      .firestore.automatic_backups,
    false,
  )
  for (const value of [
    { automaticBackups: true },
    { automaticBackups: "true" },
    ...[0, 99, 1.5, "7", null].map((backupRetentionDays) => ({
      automaticBackups: true,
      backupRetentionDays,
    })),
    { automaticBackups: false, backupRetentionDays: 7 },
    { backupRetentionDays: 7 },
  ])
    assert.throws(() => deriveSupportTerraformInputs(make(value), TARGET))
})
