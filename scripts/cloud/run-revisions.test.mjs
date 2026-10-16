import assert from "node:assert/strict"
import test from "node:test"
import { protectedRevisionNames } from "./run-revisions.mjs"

function service() {
  return {
    spec: {
      template: { spec: { containers: [{}] } },
      traffic: [{ revisionName: "planned" }, { latestRevision: true }],
    },
    status: {
      latestCreatedRevisionName: "created",
      latestReadyRevisionName: "ready",
      traffic: [
        { revisionName: "serving", percent: 100 },
        { revisionName: "tagged", tag: "preview" },
        { revisionName: "ready", percent: 0 },
      ],
    },
  }
}

test("both traffic snapshots, tag targets and latest revisions are protected once", () => {
  assert.deepEqual(protectedRevisionNames(service()), [
    "created",
    "ready",
    "serving",
    "tagged",
    "planned",
  ])
  const observed = service()
  delete observed.spec.traffic
  assert.deepEqual(protectedRevisionNames(observed), [
    "created",
    "ready",
    "serving",
    "tagged",
  ])
})

test("unresolvable traffic and non-boolean latest flags stop retention", () => {
  for (const traffic of [
    null,
    {},
    { revisionName: "" },
    { revisionName: 1 },
    ...[false, "false", "true", 1, {}, new Boolean(true)].map(
      (latestRevision) => ({ latestRevision }),
    ),
  ]) {
    for (const field of ["spec", "status"]) {
      const incomplete = service()
      incomplete[field].traffic = [traffic]
      assert.throws(() => protectedRevisionNames(incomplete), /traffic target/)
    }
  }
})

test("missing or malformed service inventory cannot yield partial protection", () => {
  for (const mutate of [
    (value) => {
      delete value.spec.template
    },
    (value) => {
      value.spec.template.spec.containers = []
    },
    (value) => {
      value.spec.template.spec.containers = { length: 1 }
    },
    (value) => {
      delete value.status
    },
    (value) => {
      value.status.latestCreatedRevisionName = ""
    },
    (value) => {
      value.status.latestReadyRevisionName = 1
    },
    (value) => {
      value.status.traffic = []
    },
    (value) => {
      value.status.traffic = {}
    },
    (value) => {
      value.spec.traffic = null
    },
  ]) {
    const incomplete = service()
    mutate(incomplete)
    assert.throws(() => protectedRevisionNames(incomplete), /Incomplete/)
  }
})
