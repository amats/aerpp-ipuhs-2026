import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import {
  prepareSecretVersion,
  retainedSecretVersions,
  selectSecretDestruction,
} from "./secret-versions.mjs"

const secret = "RUNTIME"
const metadata = (id, state = "ENABLED") => ({
  name: `projects/123456/secrets/${secret}/versions/${id}`,
  state,
  createTime: "2026-09-24T00:00:00Z",
})
function fixture(t) {
  const output = mkdtempSync(resolve(tmpdir(), "secret-versions-"))
  t.after(() => rmSync(output, { recursive: true, force: true }))
  const versions = []
  const calls = []
  const execute = (project, args, options) => {
    calls.push({ project, args, options })
    assert.equal(project, "synthetic-test")
    assert(!args.includes("access"))
    if (args[2] === "list") return JSON.stringify(versions)
    assert.equal(args[2], "add")
    const version = metadata(versions.length + 1)
    versions.push(version)
    return JSON.stringify(version)
  }
  return { output, versions, calls, execute }
}

test("unchanged bytes reuse an enabled immutable version, changed bytes upload, and payloads stay out of receipts", (t) => {
  const f = fixture(t)
  const prepare = (value) =>
    prepareSecretVersion("synthetic-test", secret, value, f.output, f.execute)
  assert.equal(prepare("synthetic-secret\n"), "1")
  assert.equal(prepare("synthetic-secret\n"), "1")
  assert.equal(prepare("synthetic-secret"), "2")
  assert.equal(f.calls.filter((call) => call.args[2] === "add").length, 2)
  assert.equal(f.calls[0].options.input, "synthetic-secret\n")
  assert(
    !readFileSync(
      resolve(f.output, `secret-version-${secret}.json`),
      "utf8",
    ).includes("synthetic-secret"),
  )
})

test("disabled, destroyed, deleted or recreated versions cannot reuse an old receipt", (t) => {
  const f = fixture(t)
  const prepare = () =>
    prepareSecretVersion(
      "synthetic-test",
      secret,
      "synthetic",
      f.output,
      f.execute,
    )
  assert.equal(prepare(), "1")
  f.versions[0].state = "DISABLED"
  assert.equal(prepare(), "2")
  f.versions[1].state = "DESTROYED"
  assert.equal(prepare(), "3")
  f.versions[2].createTime = "2026-09-25T00:00:00Z"
  assert.equal(prepare(), "4")
  f.versions.pop()
  assert.equal(prepare(), "4")
  assert.equal(f.calls.filter((call) => call.args[2] === "add").length, 5)
})

test("upload failure has no receipt; successful partial deployment retries reuse its receipt", (t) => {
  const f = fixture(t)
  assert.throws(() =>
    prepareSecretVersion(
      "synthetic-test",
      secret,
      "synthetic",
      f.output,
      () => {
        throw new Error("upload failed")
      },
    ),
  )
  assert.equal(
    prepareSecretVersion(
      "synthetic-test",
      secret,
      "synthetic",
      f.output,
      f.execute,
    ),
    "1",
  )
  assert.equal(
    prepareSecretVersion(
      "synthetic-test",
      secret,
      "synthetic",
      f.output,
      f.execute,
    ),
    "1",
  )
  assert.equal(f.versions.length, 1)
  assert.throws(
    () =>
      prepareSecretVersion(
        "synthetic-production",
        secret,
        "synthetic",
        f.output,
        f.execute,
      ),
    /target mismatch/,
  )
  writeFileSync(resolve(f.output, `secret-version-${secret}.json`), "bad json")
  assert.throws(
    () =>
      prepareSecretVersion(
        "synthetic-test",
        secret,
        "synthetic",
        f.output,
        f.execute,
      ),
    /Cannot read/,
  )
})

test("retention keeps latest plus pins and destroys disabled old versions too", () => {
  const versions = [
    metadata(1),
    metadata(2, "DISABLED"),
    metadata(3, "DESTROYED"),
    metadata(4),
    metadata(10),
  ]
  assert.deepEqual(selectSecretDestruction(versions, secret, ["1"]), ["2", "4"])
  assert.deepEqual(selectSecretDestruction(versions, secret, []), [
    "1",
    "2",
    "4",
  ])
  assert.deepEqual(selectSecretDestruction([], secret, []), [])
  for (const pin of ["2", "3", "99", "latest"])
    assert.throws(
      () => selectSecretDestruction(versions, secret, [pin]),
      /unavailable/,
    )
  assert.throws(
    () => selectSecretDestruction([metadata(1), metadata(1)], secret, []),
    /inventory/,
  )
  assert.throws(
    () => selectSecretDestruction([metadata(1)], "OTHER", []),
    /metadata/,
  )
})

const template = (version) => ({
  spec: {
    containers: [
      {
        env: [{ valueFrom: { secretKeyRef: { name: secret, key: version } } }],
      },
    ],
  },
})
function liveFixture() {
  return {
    services: [
      {
        metadata: { name: "app" },
        spec: {
          template: template("4"),
          traffic: [{ revisionName: "old", percent: 100 }],
        },
        status: {
          latestCreatedRevisionName: "new",
          latestReadyRevisionName: "ready",
          traffic: [
            { revisionName: "old", percent: 100 },
            { revisionName: "tagged", tag: "preview" },
          ],
        },
      },
    ],
    revisions: ["old", "ready", "new", "tagged"].map((name, i) => ({
      metadata: { name },
      ...template(String(i + 1)),
    })),
  }
}
test("live traffic, tagged and latest revisions and service templates protect their secret versions", () => {
  const f = liveFixture()
  assert.deepEqual(
    retainedSecretVersions(f.services, f.revisions, [secret], ["123456"]),
    { [secret]: ["1", "2", "3", "4"] },
  )
  assert.throws(
    () =>
      retainedSecretVersions(
        f.services,
        f.revisions.slice(1),
        [secret],
        ["123456"],
      ),
    /revision/,
  )
  f.services[0].spec.template = template("latest")
  assert.throws(
    () => retainedSecretVersions(f.services, f.revisions, [secret], ["123456"]),
    /numeric/,
  )
})

test("volume aliases are resolved with project checks and alias versions fail closed", () => {
  const f = liveFixture()
  f.services[0].spec.template = {
    metadata: {
      annotations: {
        "run.googleapis.com/secrets": `lookup:projects/123456/secrets/${secret}`,
      },
    },
    spec: {
      containers: [{}],
      volumes: [
        {
          secret: {
            secretName: "lookup",
            items: [{ key: "8", path: "secret" }],
          },
        },
      ],
    },
  }
  assert(
    retainedSecretVersions(f.services, f.revisions, [secret], ["123456"])[
      secret
    ].includes("8"),
  )
  assert.throws(
    () => retainedSecretVersions(f.services, f.revisions, [secret], ["other"]),
    /Cross-project/,
  )
  f.services[0].spec.template.spec.volumes[0].secret.items = []
  assert.throws(
    () => retainedSecretVersions(f.services, f.revisions, [secret], ["123456"]),
    /numeric/,
  )
})

test("planned secret references remain protected and invalid latest flags stop cleanup", () => {
  const f = liveFixture()
  f.revisions.push({ metadata: { name: "planned" }, ...template("5") })
  f.services[0].spec.traffic = [{ revisionName: "planned", percent: 100 }]
  assert.deepEqual(
    retainedSecretVersions(f.services, f.revisions, [secret], ["123456"]),
    { [secret]: ["1", "2", "3", "4", "5"] },
  )
  f.services[0].spec.traffic = [{ latestRevision: "false" }]
  assert.throws(
    () => retainedSecretVersions(f.services, f.revisions, [secret], ["123456"]),
    /traffic target/,
  )
})
