import assert from "node:assert/strict"
import { test } from "node:test"
import {
  addPreparedSecretPins,
  executeSecretCleanup,
} from "./prune-secrets.mjs"

test("prepared, accepted and recovery records remain protected and cross-project evidence fails closed", () => {
  const pins = {
    "admin-session": ["3"],
    "admin-oauth": ["3"],
    SUPPORT_RUNTIME_JSON: ["6"],
  }
  const records = {
    admin: [
      {
        project: "synthetic",
        versions: {
          NEXTAUTH_SECRET: "admin-session:2",
          ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "admin-oauth:2",
        },
      },
    ],
    support: [
      { project: "synthetic", runtimeVersion: "4" },
      { project: "synthetic", runtimeVersion: "5" },
    ],
  }
  assert.deepEqual(
    addPreparedSecretPins(structuredClone(pins), records, "synthetic"),
    {
      "admin-session": ["2", "3"],
      "admin-oauth": ["2", "3"],
      SUPPORT_RUNTIME_JSON: ["4", "5", "6"],
    },
  )
  assert.throws(() => addPreparedSecretPins(pins, records, "other"), /evidence/)
})

test("email-seal rollout protects both staged three-secret and serving two-secret revisions", () => {
  const pins = {
    "admin-session": ["3"],
    "admin-oauth": ["3"],
    "admin-email-seal": [],
  }
  const serving = {
    project: "synthetic",
    versions: {
      NEXTAUTH_SECRET: "admin-session:2",
      ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "admin-oauth:2",
    },
  }
  const prepared = {
    project: "synthetic",
    versions: {
      NEXTAUTH_SECRET: "admin-session:3",
      ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "admin-oauth:3",
      SESSION_SEAL_PASSWORD: "admin-email-seal:1",
    },
  }
  assert.deepEqual(
    addPreparedSecretPins(
      structuredClone(pins),
      { admin: [serving, prepared], support: [] },
      "synthetic",
    ),
    {
      "admin-session": ["2", "3"],
      "admin-oauth": ["2", "3"],
      "admin-email-seal": ["1"],
    },
  )
  for (const versions of [
    { SESSION_SEAL_PASSWORD: "admin-email-seal:1" },
    { ...prepared.versions, UNKNOWN: "admin-email-seal:1" },
    { ...prepared.versions, SESSION_SEAL_PASSWORD: "admin-session:3" },
    { ...prepared.versions, SESSION_SEAL_PASSWORD: "admin-email-seal:latest" },
    { ...prepared.versions, SESSION_SEAL_PASSWORD: "unmanaged:1" },
    { ...prepared.versions, SESSION_SEAL_PASSWORD: null },
  ])
    assert.throws(() =>
      addPreparedSecretPins(
        structuredClone(pins),
        { admin: [{ ...prepared, versions }], support: [] },
        "synthetic",
      ),
    )
})

test("identifier-secret rollout protects serving and staged secret versions", () => {
  const pins = {
    "admin-session": ["3"],
    "admin-oauth": ["3"],
    "admin-email-seal": ["1"],
    "admin-identifier-hash": [],
  }
  const serving = {
    project: "synthetic",
    versions: {
      NEXTAUTH_SECRET: "admin-session:3",
      ADMIN_GOOGLE_OAUTH_CLIENT_SECRET: "admin-oauth:3",
      SESSION_SEAL_PASSWORD: "admin-email-seal:1",
    },
  }
  const prepared = {
    ...serving,
    versions: {
      ...serving.versions,
      IDENTIFIER_HASH_SECRET: "admin-identifier-hash:2",
    },
  }
  assert.deepEqual(
    addPreparedSecretPins(
      structuredClone(pins),
      { admin: [serving, prepared], support: [] },
      "synthetic",
    ),
    { ...pins, "admin-identifier-hash": ["2"] },
  )
  for (const reference of ["admin-identifier-hash:latest", "unmanaged:1", null])
    assert.throws(() =>
      addPreparedSecretPins(
        structuredClone(pins),
        {
          admin: [
            {
              ...prepared,
              versions: {
                ...prepared.versions,
                IDENTIFIER_HASH_SECRET: reference,
              },
            },
          ],
          support: [],
        },
        "synthetic",
      ),
    )
})

function fixture() {
  const versions = [1, 2, 3].map((id) => ({
    name: `projects/123/secrets/RUNTIME/versions/${id}`,
    state: "ENABLED",
  }))
  const calls = []
  const reports = []
  return {
    versions,
    calls,
    reports,
    options: {
      project: "synthetic",
      environment: "test",
      secrets: ["RUNTIME"],
      collectPins: () => ({ RUNTIME: ["3"] }),
      save: (report) => reports.push(structuredClone(report)),
      execute: (project, args) => {
        assert.equal(project, "synthetic")
        calls.push(args)
        if (args[2] === "list") return JSON.stringify(versions)
        assert.equal(args[2], "destroy")
        versions.find((item) => item.name.endsWith(`/${args[3]}`)).state =
          "DESTROYED"
        return ""
      },
    },
  }
}

test("preview is read-only; apply destroys only candidates and persists progress", () => {
  const f = fixture()
  executeSecretCleanup({ ...f.options, apply: false })
  assert(f.calls.every((args) => args[2] === "list"))
  const result = executeSecretCleanup({ ...f.options, apply: true })
  assert.deepEqual(result.secrets[0].destroyed, ["1", "2"])
  assert.equal(f.versions[2].state, "ENABLED")
  assert.deepEqual(f.reports.at(-1).secrets[0].destroyed, ["1", "2"])
})

test("non-boolean apply flags stop before inventory, evidence writes or destruction", () => {
  for (const apply of [
    "false",
    "true",
    1,
    {},
    null,
    new Boolean(false),
    Promise.resolve(false),
  ]) {
    const f = fixture()
    assert.throws(
      () => executeSecretCleanup({ ...f.options, apply }),
      /boolean/,
    )
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.reports, [])
  }
  const f = fixture()
  executeSecretCleanup(f.options)
  assert.equal(f.reports.at(-1).apply, false)
  assert.equal(
    f.calls.every((args) => args[2] === "list"),
    true,
  )
})

test("live reference drift stops before destruction and a later failure preserves partial evidence", () => {
  const f = fixture()
  let reads = 0
  assert.throws(
    () =>
      executeSecretCleanup({
        ...f.options,
        apply: true,
        collectPins: () => ({ RUNTIME: ++reads === 1 ? ["3"] : ["1", "3"] }),
      }),
    /protection changed/,
  )
  assert(f.versions.every((item) => item.state === "ENABLED"))
  assert.throws(
    () =>
      executeSecretCleanup({
        ...f.options,
        apply: true,
        execute: (project, args) => {
          if (args[2] === "destroy" && args[3] === "2")
            throw new Error("operation failed")
          return f.options.execute(project, args)
        },
      }),
    /operation failed/,
  )
  assert.deepEqual(f.reports.at(-1).secrets[0].destroyed, ["1"])
})

test("all inventories validate before any destructive operation", () => {
  const f = fixture()
  assert.throws(() =>
    executeSecretCleanup({
      ...f.options,
      apply: true,
      secrets: ["RUNTIME", "MISSING"],
      collectPins: () => ({ RUNTIME: ["3"], MISSING: ["1"] }),
    }),
  )
  assert(f.calls.every((args) => args[2] === "list"))
})

test("delayed or unconfirmed destruction stops and records the attempt without claiming completion", () => {
  const f = fixture()
  assert.throws(
    () =>
      executeSecretCleanup({
        ...f.options,
        apply: true,
        execute: (project, args) => {
          if (args[2] === "destroy") {
            f.versions[0].state = "DISABLED"
            return ""
          }
          return f.options.execute(project, args)
        },
      }),
    /not confirmed/,
  )
  assert.deepEqual(f.reports.at(-1).secrets[0].attempted, ["1"])
  assert.deepEqual(f.reports.at(-1).secrets[0].destroyed, [])
  assert.equal(f.versions[1].state, "ENABLED")
})
