import assert from "node:assert/strict"
import test from "node:test"
import {
  assertImageCleanupPolicies,
  retainedDigests,
} from "./image-retention-policy.mjs"

const repository = "region-docker.pkg.dev/synthetic/repository/app"
const digest = (n) => `sha256:${String(n).repeat(64)}`
const revision = (n) => ({
  metadata: {
    name: `revision-${n}`,
    creationTimestamp: `2026-09-0${n}T00:00:00Z`,
    labels: { "serving.knative.dev/service": "app" },
  },
  status: {
    imageDigest: `${repository}@${digest(n)}`,
    conditions: [{ type: "Ready", status: "True" }],
  },
})
const service = {
  metadata: { name: "app" },
  spec: {
    template: {
      spec: { containers: [{ image: `${repository}@${digest(4)}` }] },
    },
  },
  status: {
    latestCreatedRevisionName: "revision-4",
    latestReadyRevisionName: "revision-4",
    traffic: [{ revisionName: "revision-2", percent: 100 }],
  },
}

test("retains the latest generation, live traffic and prepared images, not old revisions", () => {
  assert.deepEqual(
    retainedDigests([service], [1, 2, 3, 4].map(revision), repository, [
      `${repository}@${digest(5)}`,
    ]),
    [2, 4, 5].map(digest),
  )
  assert.deepEqual(retainedDigests([], [], repository), [])
  assert.throws(
    () => retainedDigests([service], [revision(4)], repository),
    /protected/,
  )
  assert.throws(
    () => retainedDigests([], [], repository, [`other@${digest(5)}`]),
    /selected repository/,
  )
})

test("cleanup policies cannot omit serving protection or broaden deletion", () => {
  const condition = {
    newer_than: "",
    older_than: "",
    package_name_prefixes: [],
    tag_prefixes: [],
    tag_state: "ANY",
    version_name_prefixes: [],
  }
  const value = {
    cleanup_policy_dry_run: false,
    cleanup_policies: [
      {
        id: "delete-old",
        action: "DELETE",
        condition: [{ ...condition, older_than: "86400s" }],
        most_recent_versions: [],
      },
      {
        id: "keep-recent",
        action: "KEEP",
        condition: [],
        most_recent_versions: [{ keep_count: 1, package_name_prefixes: [] }],
      },
      {
        id: "keep-deployed",
        action: "KEEP",
        condition: [
          { ...condition, version_name_prefixes: [digest(2).slice(0, 64)] },
        ],
        most_recent_versions: [],
      },
    ],
  }
  assert.doesNotThrow(() => assertImageCleanupPolicies(value, [digest(2)]))
  value.cleanup_policies[0].condition[0].newer_than = null
  assert.doesNotThrow(() => assertImageCleanupPolicies(value, [digest(2)]))
  assert.throws(() => assertImageCleanupPolicies(value, [digest(3)]))
  for (const mutate of [
    (v) => {
      v.cleanup_policies.pop()
    },
    (v) => {
      v.cleanup_policies[0].condition[0].older_than = "1s"
    },
    (v) => {
      v.cleanup_policies[1].most_recent_versions[0].package_name_prefixes = [
        "other",
      ]
    },
  ]) {
    const changed = structuredClone(value)
    mutate(changed)
    assert.throws(() => assertImageCleanupPolicies(changed, [digest(2)]))
  }
})

test("planned traffic and tagged destinations protect images before status converges", () => {
  const changing = structuredClone(service)
  changing.spec.traffic = [
    { revisionName: "revision-1", percent: 100 },
    { revisionName: "revision-3", tag: "preview" },
  ]
  assert.deepEqual(
    retainedDigests([changing], [1, 2, 3, 4].map(revision), repository),
    [1, 2, 3, 4].map(digest),
  )
  changing.spec.traffic = [{ latestRevision: "false" }]
  assert.throws(
    () => retainedDigests([changing], [1, 2, 3, 4].map(revision), repository),
    /traffic target/,
  )
})

test("incomplete service status stops image retention instead of omitting protection", () => {
  for (const field of [
    "traffic",
    "latestCreatedRevisionName",
    "latestReadyRevisionName",
  ]) {
    const incomplete = structuredClone(service)
    delete incomplete.status[field]
    assert.throws(
      () =>
        retainedDigests([incomplete], [1, 2, 3, 4].map(revision), repository),
      /Incomplete/,
    )
  }
})

test("repository changes cannot hide still-serving images from retention", () => {
  const moved = structuredClone(service)
  moved.spec.template.spec.containers[0].image = `other/app@${digest(4)}`
  const newer = revision(4)
  newer.status.imageDigest = `other/app@${digest(4)}`
  assert.throws(
    () => retainedDigests([moved], [revision(2), newer], repository),
    /selected repository/,
  )
  assert.deepEqual(
    retainedDigests([moved], [revision(2), newer], `${repository}-other`),
    [],
  )
})

test("repository matching does not include packages with a shared name prefix", () => {
  const similar = structuredClone(service)
  const image = `${repository}-other@${digest(4)}`
  similar.spec.template.spec.containers[0].image = image
  const revisions = [2, 4].map((n) => {
    const value = revision(n)
    value.status.imageDigest = `${repository}-other@${digest(n)}`
    return value
  })
  assert.deepEqual(retainedDigests([similar], revisions, repository), [])
})
