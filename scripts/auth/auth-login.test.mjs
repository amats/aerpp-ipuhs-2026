import assert from "node:assert/strict"
import test from "node:test"
import { login } from "./auth-login.mjs"

function harness(overrides = {}) {
  const calls = []
  return {
    calls,
    options: {
      environment: {},
      readProfile: () => ({
        infrastructure: { operatorAccount: "synthetic@example.invalid" },
      }),
      exists: () => false,
      log: () => {},
      run: (...args) => {
        calls.push(args)
        return {
          status: 0,
          stdout: "[]",
        }
      },
      ...overrides,
    },
  }
}

test("gcloud login uses inherited terminal I/O", () => {
  const { calls, options } = harness()
  login("gcloud", ["test"], options)
  assert.deepEqual(
    calls.map(([tool, args]) => [tool, args]),
    [
      ["gcloud", ["--version"]],
      [
        "gcloud",
        [
          "auth",
          "list",
          "--filter=account=synthetic@example.invalid",
          "--format=json",
          "--quiet",
        ],
      ],
      [
        "gcloud",
        [
          "auth",
          "login",
          "synthetic@example.invalid",
          "--no-activate",
          "--launch-browser",
        ],
      ],
    ],
  )
  assert.equal(calls[2][2].stdio, "inherit")
  assert.equal(calls[1][2].env.CLOUDSDK_CORE_DISABLE_PROMPTS, "0")
})

test("missing CLI or failed login stops subsequent commands", () => {
  for (const failAt of [1, 2, 3]) {
    let count = 0
    const { options } = harness({
      run: () => ({ status: ++count === failAt ? 1 : 0, stdout: "[]" }),
    })
    assert.throws(
      () => login("gcloud", ["test"], options),
      /unavailable|did not complete|could not be checked/,
    )
    assert.equal(count, failAt)
  }
})

test("uses explicit gcloud config, then existing private config, then CLI default", () => {
  for (const explicit of [undefined, "/tmp/synthetic-gcloud"]) {
    for (const present of [false, true]) {
      const { calls, options } = harness({
        environment: explicit ? { CLOUDSDK_CONFIG: explicit } : {},
        exists: () => present,
      })
      login("gcloud", ["test"], options)
      const value = calls[1][2].env.CLOUDSDK_CONFIG
      if (explicit) assert.equal(value, explicit)
      else if (present) assert.match(value, /\/private\/tools\/gcloud$/)
      else assert.equal(value, undefined)
      assert.equal(calls.length, 3)
    }
  }
})

test("help and invalid arguments never start a CLI", () => {
  const { calls, options } = harness()
  login("gcloud", ["--help"], options)
  assert.throws(() => login("gcloud", ["unknown"], options), /Usage/)
  assert.throws(() => login("gcloud", ["all"], options), /Usage/)
  assert.equal(calls.length, 0)
})

test("saved active account skips login", () => {
  const { calls, options } = harness({
    run: (...args) => {
      calls.push(args)
      return {
        status: 0,
        stdout: JSON.stringify([
          { account: "synthetic@example.invalid", status: "ACTIVE" },
        ]),
      }
    },
  })
  login("gcloud", ["test"], options)
  assert.equal(calls.length, 2)
})

test("invalid status responses stop without leaking CLI output", () => {
  for (const stdout of [
    "sensitive-invalid-output",
    "null",
    "{}",
    '{"status":"error"}',
    '[{"account":"synthetic@example.invalid","status":"UNKNOWN"}]',
  ]) {
    let count = 0
    const { options } = harness({
      run: () => {
        count++
        return { status: 0, stdout }
      },
    })
    assert.throws(
      () => login("gcloud", ["test"], options),
      /unexpected login status/,
    )
    assert.equal(count, 2)
  }
})

test("explicit no-browser mode uses manual login", () => {
  const { calls, options } = harness()
  login("gcloud", ["production", "--no-browser"], options)
  assert.deepEqual(calls.at(-1).slice(0, 2), [
    "gcloud",
    [
      "auth",
      "login",
      "synthetic@example.invalid",
      "--no-activate",
      "--no-launch-browser",
    ],
  ])
})
