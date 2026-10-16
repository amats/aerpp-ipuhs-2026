import assert from "node:assert/strict"
import test from "node:test"
import { checkGmail } from "./check-support-gmail.mjs"

function fixture() {
  const saved = []
  let calls = 0
  return {
    saved,
    get calls() {
      return calls
    },
    dependencies: {
      load: () => ({
        environment: "test",
        mailMode: "gmail",
        gmail: { clientSecret: "sensitive-fixture" },
      }),
      health: async () => {
        calls++
      },
      save: (value) => saved.push(value),
    },
  }
}
test("rejects other targets before reading secrets or contacting Gmail", async () => {
  for (const args of [[], ["example"], ["test", "extra"]]) {
    const f = fixture()
    f.dependencies.load = () => assert.fail("Must not load credentials")
    await assert.rejects(checkGmail(args, f.dependencies))
    assert.equal(f.calls, 0)
  }
})
test("records health only without copying runtime secrets", async () => {
  const f = fixture()
  assert.equal(await checkGmail(["test"], f.dependencies), true)
  assert.equal(f.calls, 1)
  assert.equal(f.saved[0].mailSent, false)
  assert.equal(JSON.stringify(f.saved).includes("sensitive-fixture"), false)
})
test("sanitizes failures and replaces previous success evidence", async () => {
  for (const code of [
    "MAIL_REAUTHORIZATION_REQUIRED",
    "unsafe-sensitive-code",
  ]) {
    const f = fixture()
    f.dependencies.health = async () => {
      throw Object.assign(new Error("sensitive-fixture"), { code })
    }
    assert.equal(await checkGmail(["test"], f.dependencies), false)
    assert.equal(f.saved[0].healthy, false)
    assert.equal(
      f.saved[0].failureCode,
      code === "MAIL_REAUTHORIZATION_REQUIRED"
        ? code
        : "MAIL_TEMPORARILY_UNAVAILABLE",
    )
    assert.equal(JSON.stringify(f.saved).includes("sensitive-fixture"), false)
  }
})
test("rejects local sink and mismatched runtime before token refresh", async () => {
  const f = fixture()
  f.dependencies.load = () => ({ environment: "local", mailMode: "sink" })
  await assert.rejects(checkGmail(["test"], f.dependencies))
  assert.equal(f.calls, 0)
})

test("production token checks select only production configuration", async () => {
  const f = fixture()
  f.dependencies.load = (environment) => {
    assert.equal(environment, "production")
    return { environment, mailMode: "gmail", gmail: {} }
  }
  assert.equal(await checkGmail(["production"], f.dependencies), true)
  assert.equal(f.saved[0].target, "production")
})
