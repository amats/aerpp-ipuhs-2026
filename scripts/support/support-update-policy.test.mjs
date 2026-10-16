import assert from "node:assert/strict"
import test from "node:test"
import {
  permitsMaintenanceUpdate,
  selectMailAdmissionEvidence,
} from "./support-update-policy.mjs"

test("a new Admin repository may materialize its mutable Docker default without changing other settings", () => {
  const before = {
    project: "synthetic-test",
    repository_id: "admin",
    docker_config: [],
    cleanup_policy_dry_run: false,
    cleanup_policies: [
      {
        id: "delete-old",
        action: "DELETE",
        condition: [{ tag_state: "ANY", older_than: "86400s" }],
      },
      {
        id: "keep-recent",
        action: "KEEP",
        most_recent_versions: [{ keep_count: 1 }],
      },
    ],
  }
  const resource = {
    address: "google_artifact_registry_repository.admin[0]",
    change: {
      actions: ["update"],
      before,
      after: {
        ...structuredClone(before),
        docker_config: [{ immutable_tags: false }],
      },
    },
  }
  assert.equal(permitsMaintenanceUpdate(resource), true)
  assert.deepEqual(before.docker_config, [])
  for (const mutate of [
    (value) => {
      value.docker_config[0].immutable_tags = true
    },
    (value) => {
      value.repository_id = "other"
    },
    (value) => {
      value.project = "other"
    },
    (value) => {
      value.cleanup_policies[0].condition[0].older_than = "1s"
    },
  ]) {
    const changed = structuredClone(resource)
    mutate(changed.change.after)
    assert.equal(permitsMaintenanceUpdate(changed), false)
  }
})

test("secret version and Scheduler pause updates preserve image and target boundaries", () => {
  const value = {
    template: [
      {
        containers: [
          {
            image: "pinned",
            env: [
              {
                value_source: [
                  {
                    secret_key_ref: [
                      { secret: "SUPPORT_RUNTIME_JSON", version: "1" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  const resource = {
    address: "google_cloud_run_v2_service.support[0]",
    change: {
      actions: ["update"],
      before: value,
      after: structuredClone(value),
    },
  }
  resource.change.after.template[0].containers[0].env[0].value_source[0].secret_key_ref[0].version =
    "2"
  assert.equal(permitsMaintenanceUpdate(resource), true)
  resource.change.after.template[0].containers[0].image = "different"
  assert.equal(permitsMaintenanceUpdate(resource), false)
  const job = {
    address: 'google_cloud_scheduler_job.support["mail-health"]',
    change: {
      actions: ["update"],
      before: { paused: true, uri: "fixed" },
      after: { paused: false, uri: "fixed" },
    },
  }
  assert.equal(permitsMaintenanceUpdate(job), true)
  job.change.after.uri = "different"
  assert.equal(permitsMaintenanceUpdate(job), false)
})

test("Support image updates require the same repository and preserve all other service settings", () => {
  const before = {
    template: [
      {
        service_account: "runtime",
        containers: [
          {
            image: `registry.invalid/support@sha256:${"a".repeat(64)}`,
            env: [
              {
                value_source: [
                  {
                    secret_key_ref: [
                      { secret: "SUPPORT_RUNTIME_JSON", version: "1" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    traffic: [{ percent: 100 }],
  }
  const after = structuredClone(before)
  const resource = {
    address: "google_cloud_run_v2_service.support[0]",
    change: { actions: ["update"], before, after },
  }
  before.labels = { "aerpp-component": "support", "aerpp-environment": "test" }
  after.labels = structuredClone(before.labels)
  after.template[0].labels = structuredClone(before.labels)
  assert.equal(permitsMaintenanceUpdate(resource), true)
  for (const labels of [
    { "aerpp-component": "admin", "aerpp-environment": "test" },
    { "aerpp-component": "support", "aerpp-environment": "production" },
    {
      "aerpp-component": "support",
      "aerpp-environment": "test",
      extra: "unexpected",
    },
    { "aerpp-component": "support" },
  ]) {
    after.template[0].labels = labels
    assert.equal(permitsMaintenanceUpdate(resource), false)
  }
  after.template[0].labels = structuredClone(before.labels)
  after.template[0].containers[0].image = `registry.invalid/support@sha256:${"b".repeat(64)}`
  assert.equal(permitsMaintenanceUpdate(resource), true)
  for (const invalid of [
    "registry.invalid/support:latest",
    `registry.invalid/other@sha256:${"b".repeat(64)}`,
  ]) {
    const changed = structuredClone(resource)
    changed.change.after.template[0].containers[0].image = invalid
    assert.equal(permitsMaintenanceUpdate(changed), false)
  }
  after.template[0].service_account = "different"
  assert.equal(permitsMaintenanceUpdate(resource), false)
  after.template[0].service_account = "runtime"
  after.traffic[0].percent = 0
  assert.equal(permitsMaintenanceUpdate(resource), false)
})

test("Support may enable request-based billing without changing resource limits or disabling it again", () => {
  const before = {
    template: [
      {
        containers: [
          {
            image: `registry.invalid/support@sha256:${"a".repeat(64)}`,
            resources: [
              {
                cpu_idle: false,
                limits: { cpu: "1", memory: "512Mi" },
                startup_cpu_boost: false,
              },
            ],
            env: [
              {
                value_source: [
                  {
                    secret_key_ref: [
                      { secret: "SUPPORT_RUNTIME_JSON", version: "1" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  const after = structuredClone(before)
  after.template[0].containers[0].resources[0].cpu_idle = true
  const resource = {
    address: "google_cloud_run_v2_service.support[0]",
    change: { actions: ["update"], before, after },
  }
  const original = structuredClone(resource)
  assert.equal(permitsMaintenanceUpdate(resource), true)
  assert.deepEqual(resource, original)

  for (const patch of [
    { limits: { cpu: "2", memory: "512Mi" } },
    { limits: { cpu: "1", memory: "1Gi" } },
    { startup_cpu_boost: true },
  ]) {
    const changed = structuredClone(resource)
    Object.assign(
      changed.change.after.template[0].containers[0].resources[0],
      patch,
    )
    assert.equal(permitsMaintenanceUpdate(changed), false)
  }
  assert.equal(
    permitsMaintenanceUpdate({
      ...resource,
      change: { actions: ["update"], before: after, after: before },
    }),
    false,
  )
  const missing = structuredClone(resource)
  delete missing.change.after.template[0].containers[0].resources[0].cpu_idle
  assert.equal(permitsMaintenanceUpdate(missing), false)
})

test("Support startup checks may run every second while preserving the startup budget and service settings", () => {
  const before = {
    template: [
      {
        scaling: [{ min_instance_count: 0, max_instance_count: 1 }],
        containers: [
          {
            image: `registry.invalid/support@sha256:${"a".repeat(64)}`,
            startup_probe: [
              {
                http_get: [{ path: "/health", port: 8080 }],
                initial_delay_seconds: 0,
                timeout_seconds: 1,
                period_seconds: 10,
                failure_threshold: 3,
              },
            ],
            env: [
              {
                value_source: [
                  {
                    secret_key_ref: [
                      { secret: "SUPPORT_RUNTIME_JSON", version: "1" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  const after = structuredClone(before)
  Object.assign(after.template[0].containers[0].startup_probe[0], {
    period_seconds: 1,
    failure_threshold: 30,
  })
  const resource = {
    address: "google_cloud_run_v2_service.support[0]",
    change: { actions: ["update"], before, after },
  }
  const original = structuredClone(resource)
  assert.equal(permitsMaintenanceUpdate(resource), true)
  assert.deepEqual(resource, original)
  assert.equal(
    permitsMaintenanceUpdate({
      ...resource,
      change: { actions: ["update"], before: after, after: before },
    }),
    false,
  )
  for (const [side, patch] of [
    ["before", { period_seconds: 5 }],
    ["before", { failure_threshold: 6 }],
    ["before", { period_seconds: undefined }],
    ["after", { period_seconds: 2, failure_threshold: 15 }],
    ["after", { failure_threshold: 3 }],
    ["after", { failure_threshold: 60 }],
    ["after", { period_seconds: "1" }],
    ["after", { failure_threshold: "30" }],
    ["after", { period_seconds: null }],
    ["after", { failure_threshold: undefined }],
    ["after", { timeout_seconds: 2 }],
    ["after", { initial_delay_seconds: 10 }],
    ["after", { http_get: [{ path: "/other", port: 8080 }] }],
    ["after", { http_get: [{ path: "/health", port: 9090 }] }],
    ["after", { http_get: [], tcp_socket: [{ port: 8080 }] }],
  ]) {
    const changed = structuredClone(resource)
    Object.assign(
      changed.change[side].template[0].containers[0].startup_probe[0],
      patch,
    )
    assert.equal(permitsMaintenanceUpdate(changed), false)
  }
  for (const side of ["before", "after"]) {
    for (const probes of [undefined, [], [null], [{}, {}]]) {
      const changed = structuredClone(resource)
      changed.change[side].template[0].containers[0].startup_probe = probes
      assert.equal(permitsMaintenanceUpdate(changed), false)
    }
  }
  const scaled = structuredClone(resource)
  scaled.change.after.template[0].scaling[0].min_instance_count = 1
  assert.equal(permitsMaintenanceUpdate(scaled), false)
  const subsequent = structuredClone(resource)
  subsequent.change.before = structuredClone(after)
  subsequent.change.after.template[0].containers[0].env[0].value_source[0].secret_key_ref[0].version =
    "2"
  assert.equal(permitsMaintenanceUpdate(subsequent), true)
})

test("cleanup scheduling moves to thirty minutes without changing the target or mail frequency", () => {
  const change = {
    actions: ["update"],
    before: { schedule: "*/5 * * * *", paused: false, uri: "fixed" },
    after: { schedule: "*/30 * * * *", paused: false, uri: "fixed" },
  }
  const resource = {
    address: 'google_cloud_scheduler_job.support["withdrawal-cleanup"]',
    change,
  }
  assert.equal(permitsMaintenanceUpdate(resource), true)
  assert.equal(
    permitsMaintenanceUpdate({
      ...resource,
      address: 'google_cloud_scheduler_job.support["mail-health"]',
    }),
    false,
  )
  change.after.uri = "other"
  assert.equal(permitsMaintenanceUpdate(resource), false)
})

test("Scheduler deadlines move from sixty to seventy-five seconds while preserving targets", () => {
  for (const operation of ["withdrawal-cleanup", "mail-health"]) {
    const schedule =
      operation === "withdrawal-cleanup" ? "*/30 * * * *" : "0 */6 * * *"
    const resource = {
      address: `google_cloud_scheduler_job.support["${operation}"]`,
      change: {
        actions: ["update"],
        before: { attempt_deadline: "60s", schedule, uri: "fixed" },
        after: { attempt_deadline: "75s", schedule, uri: "fixed" },
      },
    }
    assert.equal(permitsMaintenanceUpdate(resource), true)
    for (const [before, after] of [
      ["75s", "60s"],
      ["60s", "90s"],
      ["30s", "75s"],
      [undefined, "75s"],
      ["60s", undefined],
    ]) {
      const changed = structuredClone(resource)
      changed.change.before.attempt_deadline = before
      changed.change.after.attempt_deadline = after
      assert.equal(permitsMaintenanceUpdate(changed), false)
    }
    const changedTarget = structuredClone(resource)
    changedTarget.change.after.uri = "other"
    assert.equal(permitsMaintenanceUpdate(changedTarget), false)
  }
})

test("test mail admission accepts the participant pattern and requires coherent data/Scheduler evidence", async () => {
  const { assertMailAdmission } = await import("./support-update-policy.mjs")
  const runtime = {
    admissionOpen: true,
    environment: "test",
    projectId: "synthetic",
    maintenanceEnabled: true,
    mailMode: "gmail",
    gmail: {
      sender: "sender@example.invalid",
      participantEmailPattern: "^.+@example[.]invalid$",
    },
  }
  const evidence = {
    cloud: { project: "synthetic", image: "pinned", revision: "revision" },
    data: {
      project: "synthetic",
      ttlActive: true,
      runtimeSha256: "hash",
      checks: [200, 503, 403].map((status) => ({ status })),
    },
    scheduler: {
      project: "synthetic",
      revision: "revision",
      runtimeSha256: "hash",
      checks: ["withdrawal-cleanup", "mail-health"].map((operation) => ({
        operation,
        schedulerStatus: 200,
        serviceStatus: 200,
        skipped: false,
      })),
    },
  }
  assert.doesNotThrow(() => assertMailAdmission(runtime, evidence, "pinned"))
  for (const patch of [
    { environment: "local" },
    { projectId: "other" },
    { maintenanceEnabled: false },
  ])
    assert.throws(() =>
      assertMailAdmission({ ...runtime, ...patch }, evidence, "pinned"),
    )
  assert.throws(() => assertMailAdmission(runtime, evidence, "different"))
  assert.throws(() =>
    assertMailAdmission(
      runtime,
      {
        ...evidence,
        scheduler: { ...evidence.scheduler, runtimeSha256: "other" },
      },
      "pinned",
    ),
  )
  assert.throws(() =>
    assertMailAdmission(
      runtime,
      {
        ...evidence,
        scheduler: {
          ...evidence.scheduler,
          checks: evidence.scheduler.checks.map((check) => ({
            ...check,
            skipped: true,
          })),
        },
      },
      "pinned",
    ),
  )
  const stale = { ...evidence, cloud: { ...evidence.cloud, image: "old" } }
  assert.equal(
    selectMailAdmissionEvidence(runtime, stale, evidence, "pinned"),
    evidence,
  )
  assert.equal(
    selectMailAdmissionEvidence(runtime, evidence, undefined, "pinned"),
    evidence,
  )
  assert.throws(() =>
    selectMailAdmissionEvidence(runtime, stale, undefined, "pinned"),
  )
  assert.throws(() =>
    selectMailAdmissionEvidence(
      runtime,
      stale,
      { ...evidence, scheduler: {} },
      "pinned",
    ),
  )
})

test("notification updates only change the configured email label", () => {
  const r = {
    address: "google_monitoring_notification_channel.support[0]",
    change: {
      actions: ["update"],
      before: {
        type: "email",
        labels: { email_address: "old@example.invalid" },
      },
      after: {
        type: "email",
        labels: { email_address: "new@example.invalid" },
      },
    },
  }
  assert.equal(permitsMaintenanceUpdate(r), true)
  r.change.after.type = "webhook"
  assert.equal(permitsMaintenanceUpdate(r), false)
})

test("Admin Terraform updates allow staged image/runtime/traffic but never identity changes", () => {
  const before = {
    template: [
      {
        service_account: "synthetic",
        containers: [
          { image: "old", env: [{ name: "SETTING", value: "old" }] },
        ],
      },
    ],
    traffic: [{ revision: "old", percent: 100 }],
  }
  const change = (after) => ({
    address: "google_cloud_run_v2_service.admin[0]",
    change: { actions: ["update"], before, after },
  })
  const after = structuredClone(before)
  after.template[0].containers[0].image = "new"
  after.template[0].containers[0].env[0].value = "new"
  assert.equal(permitsMaintenanceUpdate(change(after)), true)
  after.traffic[0].revision = "new"
  assert.equal(permitsMaintenanceUpdate(change(after)), true)
  after.template[0].service_account = "different"
  assert.equal(permitsMaintenanceUpdate(change(after)), false)
})

test("Admin may extend archive request time from 60s to 120s without widening other service changes", () => {
  const before = {
    template: [
      {
        timeout: "60s",
        service_account: "synthetic",
        containers: [{ image: "pinned", env: [] }],
      },
    ],
    traffic: [{ percent: 100 }],
  }
  const resource = {
    address: "google_cloud_run_v2_service.admin[0]",
    change: { actions: ["update"], before, after: structuredClone(before) },
  }
  resource.change.after.template[0].timeout = "120s"
  const original = structuredClone(resource)
  assert.equal(permitsMaintenanceUpdate(resource), true)
  assert.deepEqual(resource, original)
  for (const timeout of ["30s", "90s", "600s"]) {
    const changed = structuredClone(resource)
    changed.change.after.template[0].timeout = timeout
    assert.equal(permitsMaintenanceUpdate(changed), false)
  }
  const reversed = structuredClone(resource)
  reversed.change.before.template[0].timeout = "120s"
  reversed.change.after.template[0].timeout = "60s"
  assert.equal(permitsMaintenanceUpdate(reversed), false)
  resource.change.after.template[0].service_account = "other"
  assert.equal(permitsMaintenanceUpdate(resource), false)
})

test("monitoring filter review cannot silently alter channels or notification strategy", () => {
  const before = {
    conditions: [{ condition_matched_log: [{ filter: "old" }] }],
    notification_channels: ["channel"],
    alert_strategy: [{ auto_close: "1800s" }],
  }
  const after = structuredClone(before)
  after.conditions[0].condition_matched_log[0].filter = "reviewed"
  after.documentation = [
    { mime_type: "text/markdown", content: "Reviewed operator instructions" },
  ]
  const resource = {
    address: "google_monitoring_alert_policy.support_errors[0]",
    change: { actions: ["update"], before, after },
  }
  assert.equal(permitsMaintenanceUpdate(resource), true)
  after.notification_channels = ["different"]
  assert.equal(permitsMaintenanceUpdate(resource), false)
})
