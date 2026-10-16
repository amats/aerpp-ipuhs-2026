import assert from "node:assert/strict"
import { test } from "node:test"
import { assertFoundationPlan } from "./plan-policy.mjs"

const PROJECT = "synthetic-test-project"
const REGION = "asia-northeast1"
function plan(actions = ["create"]) {
  return {
    variables: { project_id: { value: PROJECT }, region: { value: REGION } },
    resource_changes: [
      {
        address: "google_service_account.support",
        change: { actions, after: { project: PROJECT } },
      },
    ],
  }
}
test("foundation accepts only additive changes to its owned test resources", () => {
  assert.doesNotThrow(() => assertFoundationPlan(plan(), PROJECT, REGION))
  assert.doesNotThrow(() =>
    assertFoundationPlan(plan(["no-op"]), PROJECT, REGION),
  )
  for (const actions of [
    ["update"],
    ["delete"],
    ["delete", "create"],
    ["read"],
  ])
    assert.throws(() => assertFoundationPlan(plan(actions), PROJECT, REGION))
  const other = plan()
  other.resource_changes[0].address = "google_firestore_database.existing"
  assert.throws(() => assertFoundationPlan(other, PROJECT, REGION))
})

test("foundation permits creation of the Admin contact-export secrets and rejects its destruction", () => {
  for (const resource of [
    "google_secret_manager_secret",
    "google_secret_manager_secret_iam_member",
  ])
    for (const key of ["SESSION_SEAL_PASSWORD", "IDENTIFIER_HASH_SECRET"]) {
      const p = plan()
      p.resource_changes[0].address = `${resource}.admin["${key}"]`
      assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
      p.resource_changes[0].change.actions = ["delete"]
      assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
    }
})

test("foundation rejects deletion of retained monitoring resources", () => {
  for (const address of [
    "google_monitoring_notification_channel.support[0]",
    "google_monitoring_alert_policy.support_errors[0]",
  ]) {
    const p = plan(["delete"])
    p.resource_changes[0].address = address
    p.resource_changes[0].change.after = null
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
  }
})

test("foundation rejects mixed targets and invalid commands before any cloud operation", () => {
  assert.throws(() => assertFoundationPlan(plan(), "another-project", REGION))
  assert.throws(() => assertFoundationPlan(plan(), PROJECT, "us-central1"))
  const other = plan()
  other.resource_changes[0].change.after.project = "another-project"
  assert.throws(() => assertFoundationPlan(other, PROJECT, REGION))
})

test("runtime IAM accepts only the selected single-secret reader", () => {
  const p = plan()
  p.resource_changes[0] = {
    address: "google_secret_manager_secret_iam_member.runtime",
    change: {
      actions: ["create"],
      after: {
        project: PROJECT,
        secret_id: "SUPPORT_RUNTIME_JSON",
        role: "roles/secretmanager.secretAccessor",
        member: `serviceAccount:aerpp-support-runtime@${PROJECT}.iam.gserviceaccount.com`,
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0].change.after.secret_id = `projects/${PROJECT}/secrets/SUPPORT_RUNTIME_JSON`
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  for (const change of [
    { role: "roles/owner" },
    { member: "allUsers" },
    { secret_id: "OTHER_SECRET" },
  ]) {
    const copy = structuredClone(p)
    Object.assign(copy.resource_changes[0].change.after, change)
    assert.throws(() => assertFoundationPlan(copy, PROJECT, REGION))
  }
})

test("service creation must match prepared image and selected identity", () => {
  const p = plan()
  const image = `registry.invalid/support@sha256:${"a".repeat(64)}`
  p.variables.deployment = { value: { image, runtime_version: "1" } }
  p.resource_changes[0] = {
    address: "google_cloud_run_v2_service.support[0]",
    change: {
      actions: ["create"],
      after: {
        project: PROJECT,
        name: "aerpp-support",
        location: REGION,
        template: [
          {
            service_account: `aerpp-support-runtime@${PROJECT}.iam.gserviceaccount.com`,
            containers: [{ image }],
          },
        ],
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0].change.after.template[0].containers[0].image = "wrong"
  assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
})

test("Firestore preparation is limited to the runtime role and support counters", () => {
  const p = plan()
  p.resource_changes[0] = {
    address: "google_project_iam_member.support_firestore",
    change: {
      actions: ["create"],
      after: {
        project: PROJECT,
        role: "roles/datastore.user",
        member: `serviceAccount:aerpp-support-runtime@${PROJECT}.iam.gserviceaccount.com`,
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0].change.after.role = "roles/owner"
  assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0] = {
    address: 'google_firestore_field.support_rate_limits["expireAt"]',
    change: {
      actions: ["create"],
      after: {
        project: PROJECT,
        database: "(default)",
        collection: "supportRateLimits",
        field: "expireAt",
        index_config: [{ indexes: [] }],
        ttl_config: [{}],
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0].change.after.collection = "participants"
  assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
})

test("database creation and preservation reject destructive and cross-project changes", () => {
  const p = plan(["no-op"])
  p.variables.firestore = { value: { location: REGION } }
  p.resource_changes[0] = {
    address: 'google_firestore_database.primary["default"]',
    change: {
      actions: ["no-op"],
      importing: { id: `projects/${PROJECT}/databases/(default)` },
      after: {
        project: PROJECT,
        name: "(default)",
        location_id: REGION,
        type: "FIRESTORE_NATIVE",
        deletion_policy: "ABANDON",
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0].change.actions = ["create"]
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  for (const actions of [["update"], ["delete"], ["delete", "create"]]) {
    const copy = structuredClone(p)
    copy.resource_changes[0].change.actions = actions
    assert.throws(() => assertFoundationPlan(copy, PROJECT, REGION))
  }
  for (const patch of [
    { project: "other-project" },
    { location_id: "us-central1" },
    { deletion_policy: "DELETE" },
  ]) {
    const copy = structuredClone(p)
    Object.assign(copy.resource_changes[0].change.after, patch)
    assert.throws(() => assertFoundationPlan(copy, PROJECT, REGION))
  }
  p.resource_changes[0].change.importing.id =
    "projects/other-project/databases/(default)"
  assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
})

test("index and field preparation rejects destructive and cross-project changes", () => {
  for (const address of [
    'google_firestore_index.existing["analysisQuestionnaires"]',
    'google_firestore_field.existing["analysisQuestionnaires/pseudonym"]',
  ]) {
    const p = plan(["no-op"])
    p.variables.firestore = {
      value: { location: REGION, manage_existing_indexes: true },
    }
    p.resource_changes[0] = {
      address,
      change: {
        actions: ["no-op"],
        after: { project: PROJECT, database: "(default)" },
        importing: {
          id: `projects/${PROJECT}/databases/(default)/collectionGroups/analysisQuestionnaires/indexes/test`,
        },
      },
    }
    assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
    for (const actions of [["update"], ["delete"], ["delete", "create"]]) {
      const copy = structuredClone(p)
      copy.resource_changes[0].change.actions = actions
      assert.throws(() => assertFoundationPlan(copy, PROJECT, REGION))
    }
    p.resource_changes[0].change.importing.id =
      "projects/other/databases/(default)/collectionGroups/analysisQuestionnaires/indexes/test"
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
  }
})

test("local Admin impersonation is scoped to the selected operator and reader", () => {
  const p = plan()
  const account = `aerpp-admin-local@${PROJECT}.iam.gserviceaccount.com`
  p.variables.local_admin_account = { value: account }
  p.variables.operator_account = { value: "operator@example.invalid" }
  p.resource_changes = [
    {
      address: "google_service_account_iam_member.local_admin_operator",
      change: {
        actions: ["create"],
        after: {
          service_account_id: `projects/${PROJECT}/serviceAccounts/${account}`,
          role: "roles/iam.serviceAccountTokenCreator",
          member: "user:operator@example.invalid",
        },
      },
    },
  ]
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  for (const after of [
    { member: "allUsers" },
    { role: "roles/owner" },
    {
      service_account_id: `projects/another-project/serviceAccounts/${account}`,
    },
  ]) {
    const other = structuredClone(p)
    Object.assign(other.resource_changes[0].change.after, after)
    assert.throws(() => assertFoundationPlan(other, PROJECT, REGION))
  }
  p.resource_changes[0].change.actions = ["delete"]
  assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
})

test("Terraform reader and logging identities cannot cross projects or be replaced", () => {
  for (const [resource, key, account] of [
    ["local_admin", "local_admin_account", "aerpp-admin-local"],
    ["logging", "logging_account", "aerpp-logging"],
  ]) {
    const p = plan()
    p.variables[key] = {
      value: `${account}@${PROJECT}.iam.gserviceaccount.com`,
    }
    p.resource_changes = [
      {
        address: `google_service_account.${resource}`,
        change: {
          actions: ["create"],
          after: { project: PROJECT, account_id: account },
        },
      },
    ]
    assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
    p.resource_changes[0].change.actions = ["delete", "create"]
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
    p.resource_changes[0].change.actions = ["create"]
    p.variables[key].value =
      `${account}@another-project.iam.gserviceaccount.com`
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
  }
})

test("Admin write grants bind exact roles to the selected hosted and local identities", () => {
  for (const kind of ["admin", "local_admin"]) {
    const p = plan()
    const accountId =
      kind === "admin" ? "aerpp-admin-runtime" : "aerpp-admin-local"
    const account = `${accountId}@${PROJECT}.iam.gserviceaccount.com`
    p.variables.admin = { value: { account_id: accountId } }
    p.variables.local_admin_account = { value: account }
    p.resource_changes = [
      {
        address: `google_project_iam_member.${kind}["roles/datastore.user"]`,
        change: {
          actions: ["create"],
          after: {
            project: PROJECT,
            role: "roles/datastore.user",
            member: `serviceAccount:${account}`,
          },
        },
      },
    ]
    assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
    p.resource_changes[0].change.after.member =
      "serviceAccount:other@other-project.iam.gserviceaccount.com"
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
    p.resource_changes[0].change.after.member = `serviceAccount:${account}`
    p.resource_changes[0].change.after.role = "roles/owner"
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
    p.resource_changes[0].change.after.role = "roles/datastore.user"
    p.resource_changes[0].change.actions = ["delete"]
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
  }
})

test("backup schedules enforce explicit retention, database, target and persistent-resource protection", () => {
  const p = plan()
  p.variables.firestore = {
    value: {
      location: REGION,
      automatic_backups: true,
      backup_retention_days: 7,
    },
  }
  p.resource_changes[0] = {
    address: 'google_firestore_backup_schedule.daily["default"]',
    change: {
      actions: ["create"],
      after: {
        project: PROJECT,
        database: "(default)",
        retention: "604800s",
        daily_recurrence: [{}],
        weekly_recurrence: [],
        deletion_policy: "PREVENT",
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0].change.actions = ["no-op"]
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  for (const patch of [
    { project: "another-project" },
    { database: "other" },
    { retention: "2592000s" },
    { deletion_policy: "DELETE" },
    { daily_recurrence: [] },
    { weekly_recurrence: [{ day: "SUNDAY" }] },
  ]) {
    const bad = structuredClone(p)
    Object.assign(bad.resource_changes[0].change.after, patch)
    assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
  }
  for (const actions of [["update"], ["delete"], ["delete", "create"]]) {
    const bad = structuredClone(p)
    bad.resource_changes[0].change.actions = actions
    assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
  }
  for (const patch of [
    { automatic_backups: false },
    { backup_retention_days: 0 },
    { backup_retention_days: 99 },
    { backup_retention_days: 1.5 },
  ]) {
    const bad = structuredClone(p)
    Object.assign(bad.variables.firestore.value, patch)
    assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
  }
})

test("questionnaire archive preserves content and selected-project isolation", () => {
  const p = plan()
  p.resource_changes[0] = {
    address: "google_storage_bucket.questionnaires",
    change: {
      actions: ["create"],
      after: {
        project: PROJECT,
        name: `${PROJECT}-questionnaires`,
        location: REGION.toUpperCase(),
        uniform_bucket_level_access: true,
        public_access_prevention: "enforced",
        force_destroy: false,
        versioning: [{ enabled: true }],
        lifecycle_rule: [],
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  for (const patch of [
    { project: "another-project" },
    { name: "another-bucket" },
    { uniform_bucket_level_access: false },
    { public_access_prevention: "inherited" },
    { force_destroy: true },
    { versioning: [{ enabled: false }] },
    { lifecycle_rule: [{ action: { type: "Delete" } }] },
  ]) {
    const bad = structuredClone(p)
    Object.assign(bad.resource_changes[0].change.after, patch)
    assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
  }
  for (const actions of [["update"], ["delete"], ["delete", "create"]]) {
    const bad = structuredClone(p)
    bad.resource_changes[0].change.actions = actions
    assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
  }
})

test("questionnaire archive grants only creator/viewer to the selected operator and viewer to Admin", () => {
  const p = plan()
  p.variables.operator_account = { value: "operator@example.com" }
  p.variables.local_admin_account = {
    value: `local-admin@${PROJECT}.iam.gserviceaccount.com`,
  }
  p.variables.admin = { value: { account_id: "hosted-admin" } }
  for (const [address, role, member] of [
    [
      'google_storage_bucket_iam_member.questionnaire_operator["roles/storage.objectCreator"]',
      "roles/storage.objectCreator",
      "user:operator@example.com",
    ],
    [
      'google_storage_bucket_iam_member.questionnaire_operator["roles/storage.objectViewer"]',
      "roles/storage.objectViewer",
      "user:operator@example.com",
    ],
    [
      "google_storage_bucket_iam_member.questionnaire_local_admin",
      "roles/storage.objectViewer",
      `serviceAccount:local-admin@${PROJECT}.iam.gserviceaccount.com`,
    ],
    [
      "google_storage_bucket_iam_member.questionnaire_admin[0]",
      "roles/storage.objectViewer",
      `serviceAccount:hosted-admin@${PROJECT}.iam.gserviceaccount.com`,
    ],
  ]) {
    p.resource_changes[0] = {
      address,
      change: {
        actions: ["create"],
        after: { bucket: `${PROJECT}-questionnaires`, role, member },
      },
    }
    assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
    const refreshed = structuredClone(p)
    refreshed.resource_changes[0].change.actions = ["no-op"]
    refreshed.resource_changes[0].change.after.bucket = `b/${PROJECT}-questionnaires`
    assert.doesNotThrow(() => assertFoundationPlan(refreshed, PROJECT, REGION))
    for (const patch of [
      { bucket: "another-bucket" },
      { bucket: "b/another-bucket" },
      { bucket: `b/b/${PROJECT}-questionnaires` },
      { bucket: `gs://${PROJECT}-questionnaires` },
      { member: "allUsers" },
      { role: "roles/storage.admin" },
    ]) {
      const bad = structuredClone(p)
      Object.assign(bad.resource_changes[0].change.after, patch)
      assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
    }
    p.resource_changes[0].change.actions = ["delete"]
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
  }
})

test("foundation permits only the reviewed Admin archive timeout extension for its selected deployment", () => {
  const p = plan()
  const image = `registry.invalid/admin@sha256:${"a".repeat(64)}`
  p.variables.admin = { value: { service: "synthetic-admin", image } }
  const before = {
    project: PROJECT,
    location: REGION,
    name: "synthetic-admin",
    template: [
      {
        timeout: "60s",
        service_account: "synthetic",
        containers: [{ image, env: [] }],
      },
    ],
    traffic: [{ percent: 100 }],
  }
  p.resource_changes[0] = {
    address: "google_cloud_run_v2_service.admin[0]",
    change: { actions: ["update"], before, after: structuredClone(before) },
  }
  p.resource_changes[0].change.after.template[0].timeout = "120s"
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  p.resource_changes[0].change.after.template[0].timeout = "600s"
  assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
})

test("document archive preserves content and selected-project isolation", () => {
  const p = plan()
  p.resource_changes[0] = {
    address: "google_storage_bucket.documents",
    change: {
      actions: ["create"],
      after: {
        project: PROJECT,
        name: `${PROJECT}-documents`,
        location: REGION.toUpperCase(),
        uniform_bucket_level_access: true,
        public_access_prevention: "enforced",
        force_destroy: false,
        versioning: [{ enabled: true }],
        lifecycle_rule: [],
      },
    },
  }
  assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
  for (const patch of [
    { project: "another-project" },
    { name: "another-bucket" },
    { uniform_bucket_level_access: false },
    { public_access_prevention: "inherited" },
    { force_destroy: true },
    { versioning: [{ enabled: false }] },
    { lifecycle_rule: [{ action: { type: "Delete" } }] },
  ]) {
    const bad = structuredClone(p)
    Object.assign(bad.resource_changes[0].change.after, patch)
    assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
  }
  for (const actions of [["update"], ["delete"], ["delete", "create"]]) {
    const bad = structuredClone(p)
    bad.resource_changes[0].change.actions = actions
    assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
  }
})

test("document archive grants only creator/viewer to the selected operator and viewer to Admin", () => {
  const p = plan()
  p.variables.operator_account = { value: "operator@example.com" }
  p.variables.local_admin_account = {
    value: `local-admin@${PROJECT}.iam.gserviceaccount.com`,
  }
  p.variables.admin = { value: { account_id: "hosted-admin" } }
  for (const [address, role, member] of [
    [
      "google_storage_bucket_iam_member.document_support",
      "roles/storage.objectViewer",
      `serviceAccount:aerpp-support-runtime@${PROJECT}.iam.gserviceaccount.com`,
    ],
    [
      'google_storage_bucket_iam_member.document_operator["roles/storage.objectCreator"]',
      "roles/storage.objectCreator",
      "user:operator@example.com",
    ],
    [
      'google_storage_bucket_iam_member.document_operator["roles/storage.objectViewer"]',
      "roles/storage.objectViewer",
      "user:operator@example.com",
    ],
    [
      "google_storage_bucket_iam_member.document_local_admin",
      "roles/storage.objectViewer",
      `serviceAccount:local-admin@${PROJECT}.iam.gserviceaccount.com`,
    ],
    [
      "google_storage_bucket_iam_member.document_admin[0]",
      "roles/storage.objectViewer",
      `serviceAccount:hosted-admin@${PROJECT}.iam.gserviceaccount.com`,
    ],
  ]) {
    p.resource_changes[0] = {
      address,
      change: {
        actions: ["create"],
        after: { bucket: `${PROJECT}-documents`, role, member },
      },
    }
    assert.doesNotThrow(() => assertFoundationPlan(p, PROJECT, REGION))
    const refreshed = structuredClone(p)
    refreshed.resource_changes[0].change.actions = ["no-op"]
    refreshed.resource_changes[0].change.after.bucket = `b/${PROJECT}-documents`
    assert.doesNotThrow(() => assertFoundationPlan(refreshed, PROJECT, REGION))
    for (const patch of [
      { bucket: "another-bucket" },
      { bucket: "b/another-bucket" },
      { bucket: `b/b/${PROJECT}-documents` },
      { bucket: `gs://${PROJECT}-documents` },
      { member: "allUsers" },
      { role: "roles/storage.admin" },
    ]) {
      const bad = structuredClone(p)
      Object.assign(bad.resource_changes[0].change.after, patch)
      assert.throws(() => assertFoundationPlan(bad, PROJECT, REGION))
    }
    p.resource_changes[0].change.actions = ["delete"]
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
  }
})
