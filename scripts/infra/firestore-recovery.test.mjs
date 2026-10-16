import assert from "node:assert/strict"
import { test } from "node:test"
import {
  assertRecoveryPlan,
  assertTtlRestoration,
  recoveryTargets,
  TTL_RECOVERY_FIELDS,
} from "./firestore-recovery.mjs"
import { assertFoundationPlan } from "./terraform/plan-policy.mjs"

const PROJECT = "synthetic-test-project"
const REGION = "asia-northeast1"

function restoration(address, collection) {
  const before = {
    project: PROJECT,
    database: "(default)",
    collection,
    field: "expireAt",
    index_config: [{ indexes: [] }],
    ttl_config: [],
  }
  return {
    address,
    change: {
      actions: ["update"],
      before,
      after: {
        ...structuredClone(before),
        ttl_config: [{ state: null, expiration_offset: null }],
      },
    },
  }
}

function plan(resources) {
  return {
    variables: { project_id: { value: PROJECT }, region: { value: REGION } },
    resource_changes: resources,
  }
}

test("TTL recovery rejects index, identity, active TTL and offset changes", () => {
  for (const [address, collection] of TTL_RECOVERY_FIELDS) {
    const resource = restoration(address, collection)
    assert.doesNotThrow(() => assertTtlRestoration(resource, PROJECT))
    for (const mutate of [
      (r) => {
        r.change.actions = ["delete", "create"]
      },
      (r) => {
        r.change.before.ttl_config = [{}]
      },
      (r) => {
        r.change.before.project = "other-project"
      },
      (r) => {
        r.change.after.field = "pseudonym"
      },
      (r) => {
        r.change.after.index_config = [{ indexes: [{ order: "ASCENDING" }] }]
      },
      (r) => {
        r.change.after.ttl_config = []
      },
      (r) => {
        r.change.after.ttl_config[0].expiration_offset = "3600s"
      },
      (r) => {
        r.change.importing = { id: "unowned" }
      },
    ]) {
      const changed = structuredClone(resource)
      mutate(changed)
      assert.throws(() => assertTtlRestoration(changed, PROJECT))
    }
  }
})

test("recovery plans isolate field recovery from other infrastructure and ordinary plans", () => {
  const ttl = restoration(...TTL_RECOVERY_FIELDS.entries().next().value)
  for (const [mode, resource] of [["recover-fields", ttl]]) {
    const p = plan([resource])
    assert.doesNotThrow(() =>
      assertRecoveryPlan(p, PROJECT, REGION, mode, assertFoundationPlan),
    )
    assert.throws(() => assertFoundationPlan(p, PROJECT, REGION))
    assert.throws(() =>
      assertRecoveryPlan(
        p,
        "other-project",
        REGION,
        mode,
        assertFoundationPlan,
      ),
    )
    assert.throws(() =>
      assertRecoveryPlan(
        { ...p, errored: true },
        PROJECT,
        REGION,
        mode,
        assertFoundationPlan,
      ),
    )
    assert.doesNotThrow(() =>
      assertRecoveryPlan(
        plan([ttl]),
        PROJECT,
        REGION,
        mode,
        assertFoundationPlan,
      ),
    )
    assert.throws(() =>
      assertRecoveryPlan(
        plan([
          resource,
          {
            address: 'google_firestore_database.primary["default"]',
            change: {
              actions: ["delete"],
              before: { project: PROJECT },
              after: null,
            },
          },
        ]),
        PROJECT,
        REGION,
        mode,
        assertFoundationPlan,
      ),
    )
    assert.throws(() =>
      assertRecoveryPlan(
        p,
        PROJECT,
        REGION,
        "close-admission",
        assertFoundationPlan,
      ),
    )
  }
  assert.deepEqual(recoveryTargets("close-admission"), [
    "google_cloud_run_v2_service.support[0]",
  ])
  assert.equal(recoveryTargets("recover-fields").length, 3)
  assert.throws(() => recoveryTargets("unknown"))
})
